"""Forced alignment of a known script against its generated voiceover.

Timings come from torchaudio's MMS_FA CTC aligner, which runs locally on the
CPU. Alignment is used instead of transcription because the script text is
already known: the model only decides *when* each word is spoken, never *what*
was said, so a misheard name can never rewrite the storyboard text.

The audio is aligned in overlapping windows. A wav2vec2 emission over a full
ten-minute voiceover would need quadratic attention memory, and a fixed split
would drift; instead each window aligns the next handful of words, keeps only
those that end well before the window edge, and restarts from the end of the
last accepted word. Errors therefore cannot accumulate across windows.
"""

import logging
import re
import subprocess
import threading

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
# Window/guard are a memory-versus-overhead trade: 30s of audio is ~1500
# emission frames, which keeps peak attention memory small, and the discarded
# 4s tail costs ~15% redundant compute.
WINDOW_SECONDS = 30.0
GUARD_SECONDS = 4.0
# Deliberately below real speech rate. Handing the aligner fewer words than the
# window contains is harmless, while handing it too many squashes the surplus
# against the window edge.
WORDS_PER_SECOND = 3.0
MIN_SENTENCE_SECONDS = 0.2


class AlignmentError(Exception):
    """Alignment could not produce usable timings."""


_pipeline = None
_pipeline_lock = threading.Lock()
# Alignment saturates every core, so overlapping runs would only thrash.
_align_lock = threading.Lock()


def _load_pipeline():
    """Load the aligner once per process; the checkpoint is ~1.2 GB."""
    global _pipeline
    with _pipeline_lock:
        if _pipeline is None:
            try:
                import torch
                import torchaudio
            except ImportError as error:
                raise AlignmentError(
                    "Forced alignment needs torch and torchaudio. Install them with: "
                    "pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu"
                ) from error

            logger.info("Loading MMS_FA aligner (first run downloads ~1.2 GB)")
            bundle = torchaudio.pipelines.MMS_FA
            _pipeline = {
                "torch": torch,
                "model": bundle.get_model(with_star=False),
                "tokenizer": bundle.get_tokenizer(),
                "aligner": bundle.get_aligner(),
                "alphabet": set(bundle.get_dict()),
            }
            logger.info("MMS_FA aligner ready")
    return _pipeline


def is_available() -> bool:
    """Report whether the alignment dependencies are importable."""
    try:
        import torch  # noqa: F401
        import torchaudio  # noqa: F401
    except ImportError:
        return False
    return True


def _decode_audio(audio_bytes: bytes):
    """Decode any ffmpeg-readable audio to mono 16 kHz float32 samples."""
    import numpy as np

    try:
        completed = subprocess.run(
            ["ffmpeg", "-v", "quiet", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
            input=audio_bytes,
            capture_output=True,
            check=True,
        )
    except FileNotFoundError as error:
        raise AlignmentError("ffmpeg is required to decode the voiceover for alignment.") from error
    except subprocess.CalledProcessError as error:
        raise AlignmentError("ffmpeg could not decode the generated voiceover.") from error

    # .copy() because frombuffer views immutable bytes, which torch refuses.
    samples = np.frombuffer(completed.stdout, dtype=np.float32).copy()
    if samples.size == 0:
        raise AlignmentError("The generated voiceover contained no audio.")
    return samples


def _normalize(word: str, alphabet: set) -> str:
    """Reduce a script word to the aligner's alphabet, or "" if nothing remains."""
    lowered = word.lower().replace("’", "'")
    return "".join(char for char in lowered if char in alphabet)


def _run_aligner(pipeline, window):
    """Return a per-window aligner callable plus its frame-to-second ratio."""
    torch = pipeline["torch"]
    tensor = torch.from_numpy(window).unsqueeze(0)
    with torch.inference_mode():
        emission, _ = pipeline["model"](tensor)
    ratio = tensor.shape[1] / emission.shape[1] / SAMPLE_RATE

    def align(tokens):
        with torch.inference_mode():
            return pipeline["aligner"](emission[0], pipeline["tokenizer"](tokens))

    return align, ratio


def _align_words(pipeline, samples, words: list[str]) -> list:
    """Align normalized words to audio, returning [(start, end)] or None each."""
    timings: list = [None] * len(words)
    window_samples = int(WINDOW_SECONDS * SAMPLE_RATE)
    cursor = 0
    index = 0

    while index < len(words) and cursor < samples.size:
        window_end = min(cursor + window_samples, samples.size)
        is_final = window_end >= samples.size
        window = samples[cursor:window_end]
        window_seconds = window.size / SAMPLE_RATE
        if window_seconds < 0.2:
            break

        remaining = len(words) - index
        take = remaining if is_final else min(remaining, max(1, int(window_seconds * WORDS_PER_SECOND)))

        align, ratio = _run_aligner(pipeline, window)
        try:
            spans = align(words[index:index + take])
        except Exception as error:
            raise AlignmentError(f"The aligner rejected the script text: {error}") from error
        if not spans:
            raise AlignmentError("The aligner returned no word spans.")

        offset = cursor / SAMPLE_RATE
        cutoff = offset + window_seconds - GUARD_SECONDS
        accepted = 0
        for position, span in enumerate(spans):
            start = offset + span[0].start * ratio
            end = offset + span[-1].end * ratio
            # Words near the window edge may be squashed surplus rather than
            # real matches, so re-align them from the next window instead.
            if not is_final and end > cutoff and accepted > 0:
                break
            timings[index + position] = (start, end)
            accepted += 1

        index += accepted
        next_cursor = int(timings[index - 1][1] * SAMPLE_RATE)
        # Guarantee forward progress even if a window aligns everything at its
        # own start, which would otherwise loop forever.
        cursor = max(next_cursor, cursor + SAMPLE_RATE)

    return timings


def _sentence_bounds(sentences: list[dict], word_timings: list, word_owner: list[int], duration: float) -> list[dict]:
    """Collapse word timings into one start/end per sentence."""
    bounds: list = [None] * len(sentences)
    for position, timing in enumerate(word_timings):
        if timing is None:
            continue
        owner = word_owner[position]
        current = bounds[owner]
        bounds[owner] = (timing[0], timing[1]) if current is None else (current[0], timing[1])

    # A sentence whose words all failed to align borrows the surrounding gap.
    for index, bound in enumerate(bounds):
        if bound is not None:
            continue
        previous_end = next((bounds[j][1] for j in range(index - 1, -1, -1) if bounds[j]), 0.0)
        next_start = next((bounds[j][0] for j in range(index + 1, len(bounds)) if bounds[j]), duration)
        bounds[index] = (previous_end, max(next_start, previous_end + MIN_SENTENCE_SECONDS))

    results = []
    previous_end = 0.0
    for index, (start, end) in enumerate(bounds):
        start = max(start, previous_end)
        end = max(end, start + MIN_SENTENCE_SECONDS)
        # The exporter concatenates clips from zero and muxes with -shortest, so
        # leading silence would shift every image early and a short tail would
        # clip the audio. Pin both ends to the real audio instead.
        if index == 0:
            start = 0.0
        if index == len(bounds) - 1:
            end = max(duration, start + MIN_SENTENCE_SECONDS)
        results.append({
            "id": sentences[index].get("id"),
            "text": sentences[index].get("text", ""),
            "start": round(start, 3),
            "end": round(end, 3),
        })
        previous_end = end
    return results


def align_sentences(audio_bytes: bytes, sentences: list[dict]) -> list[dict]:
    """Time each sentence against the audio.

    ``sentences`` are ``{"id", "text"}`` in spoken order; the result adds
    ``start``/``end`` in seconds. Raises ``AlignmentError`` if the audio or the
    dependencies are unusable, so callers can fall back to estimated timings.
    """
    if not sentences:
        raise AlignmentError("There are no sentences to align.")

    pipeline = _load_pipeline()
    samples = _decode_audio(audio_bytes)
    duration = samples.size / SAMPLE_RATE

    words: list[str] = []
    word_owner: list[int] = []
    for index, sentence in enumerate(sentences):
        for raw_word in re.split(r"\s+", sentence.get("text", "").strip()):
            normalized = _normalize(raw_word, pipeline["alphabet"])
            # Numerals, emoji and non-Latin scripts leave nothing alignable.
            # Dropping them keeps the surrounding words as anchors.
            if normalized:
                words.append(normalized)
                word_owner.append(index)

    if not words:
        raise AlignmentError("The script has no words the aligner can read.")

    with _align_lock:
        word_timings = _align_words(pipeline, samples, words)

    aligned = sum(1 for timing in word_timings if timing is not None)
    if aligned < len(words) * 0.5:
        raise AlignmentError(f"Only {aligned} of {len(words)} words could be aligned.")

    logger.info("Aligned %d/%d words across %.1fs of audio", aligned, len(words), duration)
    return _sentence_bounds(sentences, word_timings, word_owner, duration)


def format_timestamp(seconds: float) -> str:
    """Render seconds as an SRT timestamp."""
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    whole_seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds:03d}"


def format_srt(timings: list[dict]) -> str:
    """Render timed sentences as an SRT document."""
    blocks = [
        f"{index + 1}\n{format_timestamp(timing['start'])} --> {format_timestamp(timing['end'])}\n{timing.get('text', '').strip()}"
        for index, timing in enumerate(timings)
    ]
    return "\n\n".join(blocks)
