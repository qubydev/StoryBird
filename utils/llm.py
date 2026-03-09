import os
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langchain_deepseek import ChatDeepSeek

load_dotenv()

DEEPSEEK_OUTPUT_TOKENS_LIMIT = 800
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
LONGCAT_API_KEY = os.getenv("LONGCAT_API_KEY")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

# All required keys validation
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is not set in .env")
if not LONGCAT_API_KEY:
    raise ValueError("LONGCAT_API_KEY is not set in .env")
if not DEEPSEEK_API_KEY:
    raise ValueError("DEEPSEEK_API_KEY is not set in .env")

# --- Model Initializations ---

model_pro = ChatDeepSeek(
    api_key=DEEPSEEK_API_KEY,
    model="deepseek-chat",
    max_tokens=DEEPSEEK_OUTPUT_TOKENS_LIMIT
)

model_base = ChatGroq(
    api_key=GROQ_API_KEY,
    model="llama-3.3-70b-versatile"
)

model_mass = ChatOpenAI(
    base_url="https://api.longcat.chat/openai",
    api_key=LONGCAT_API_KEY,
    model="LongCat-Flash-Chat"
)

# --- Pydantic Schemas ---

class ScenesWithIndexGroups(BaseModel):
    scenes: list[list[int]] = Field(..., description="list of list of line indices, groupped into scenes.")

class SceneImagePrompt(BaseModel):
    prompt: str = Field(..., description="A descriptive prompt for generating an image based on the scene lines.")

class Character(BaseModel):
    name: str = Field(..., description="The name of the character.")
    description: str = Field(..., description="One line description about the role of character in the story.")

class DetectedCharacters(BaseModel):
    characters: list[Character] = Field(..., description="A list of characters detected in the story.")

class TranscriptSentence(BaseModel):
    text: str = Field(..., description="The text of the sentence.")
    start: str = Field(..., description="The start timestamp of the sentence in the format 00:00:00,000")
    end: str = Field(..., description="The end timestamp of the sentence in the format 00:00:00,000")

class SentenceTranscript(BaseModel):
    sentences: list[TranscriptSentence] = Field(..., description="A list of sentences with their text and timestamps.")

# --- Prompts ---

GENERATE_SCENES_SYSTEM = """You are an expert Storyboard Artist and Cinematographer. You are provided with script lines, their indices, and their audio durations. Your task is to group these lines into logical visual scenes (shots) that will each be represented by a single static image.

RULES:
1. SCENE DEFINITION: A group of lines representing a similar meaning, such that they could be visually represented together in a single image. Lines that differ significantly in meaning, location, or characters should be in separate scenes.
2. TARGET DURATION: Group lines together so the cumulative duration of each scene is approximately 4 to 6 seconds. 
3. LONG LINES: If a single line's duration exceeds 6 seconds, isolate it into its own scene. Do not group other lines with it.
4. VISUAL COHESION: Group lines that naturally occur in the same shot (e.g., same location, same characters interacting).
"""

GENERATE_SCENES_USER = """Generate storyboard scenes for the following script:

**TITLE:** {title}

**LINES:**
{formatted_lines}
"""

GENERATE_IMAGE_PROMPT_SYSTEM = """You are a creative AI image prompt engineer. Your task is to write highly descriptive, visually rich text-to-image prompts based on a story scene lines. 

INPUTS:
- TITLE: The story's title.
- SCENE LINES: The script lines occurring in this specific scene.
- PREVIOUS SCENES: Context to maintain visual continuity.
- CHARACTERS: List of available characters.
- INSTRUCTIONS: User specified instructions to follow when writing the prompt.

RULES:
1. VISUALS ONLY: Describe *only* what can be seen (characters, actions, setting, lighting, camera angle, atmosphere). Omit dialogue, abstract concepts, names, or plot summaries. The image model cannot understand the story. It only generates an image based on the provided visual prompt.
2. CONTINUITY: If current scene is in continuity with previous scene, maintain consistent visual elements (e.g., same character appearances, same location details etc).
3. INDEPENDENCE: Every scene's image prompt is independent from each other, you should not refer to anything from previous scene directly. (e.g. "same room as before", "same dog as previous scene" etc are not allowed). Instead describe it in words taking from previous scene's prompt.
3. CHARACTER TAGGING: Use the strict notation [CHX] to represent a character from the provided list (where X is the index, e.g., [CH1]). Do not include any descriptive information (e.g. age, gender, profession, backstory etc) about the character in the prompt, as their visual appearance will be automatically derived from the tagged ID.
   - CORRECT: "[CH1] sitting on a wooden bench."
   - INCORRECT: "The main character [CH1] sitting on a wooden bench.", "A 12 year old boy [CH1] sitting on a wooden bench."
   - If there is no character in the current scene, just ignore the character list.
   - If a required character isn't in the provided list, describe them visually in words.
4. TAGGED CHARACTER REPRESENTATION: DO not describe much about tagged character's apperance, the apperance will be taken from tagged ID ([CHX]) automatically.
5. AI SAFETY FILTERS: Avoid violence, gore, or sexually explicit terms. Use clever, neutral, and highly descriptive language to depict dramatic moments without triggering AI safety blocks.
6. STYLE: Follow the user INSTRUCTIONS strictly.

FOLLOW THIS STRUCTURE:
[IMAGE STYLE] [CHARACTER & EXPRESSION SETTINGS] [SCENE SETTINGS] [OTHERS]
"""

GENERATE_IMAGE_PROMPT_USER = """Generate a standalone image prompt using the following inputs:

**TITLE:** {title}

**SCENE LINES:**
{scene_lines}

**PREVIOUS SCENES:**
{formatted_previous_scenes}

**CHARACTERS:**
{formatted_characters}

**INSTRUCTIONS:**
{instructions}
"""

DETECT_CHARACTERS_SYSTEM = """You are a Lead Character Designer for an animated production. Your task is to extract only the main, recurring characters from the provided script lines.

RULES:
1. FILTERING: Identify ONLY core characters who appear consistently or play a significant role. Strictly ignore background characters, generic crowds (e.g., "PEOPLE", "POLICE", "ONLOOKERS"), and one-off speaking roles.
2. DESCRIPTIONS: Provide a concise, 1 sentence description which can be used to identify the character in the story. (e.g. "The main character")
3. VISUAL FOCUS: Exclude narrators unless the script implies they are physically present on screen.
"""

DETECT_CHARACTERS_USER = """Extract the main characters for the following script:

**TITLE:** {title}

**LINES:**
{formatted_lines}
"""

SMART_TRANSCRIPT_SYSTEM = """You are an expert Audio Transcriptionist. You will receive an SRT transcript (either word-level or sentence-level). Your goal is to output cleanly formatted, sentence-level timestamps.

RULES:
1. PRESERVATION: DO NOT alter, add, or remove any spoken words from the text.
2. CHUNKING: If the input is word-level, combine the words into natural, grammatically sound sentences.
3. SIZE: If a line is very long, try to break it into two parts at a natural pause (e.g., conjunctions, punctuation etc).
4. TIMESTAMPS: For merged sentences, use the start time of the first word and the end time of the last word. If the input is already sentence-level, return it exactly as-is.
"""

SMART_TRANSCRIPT_USER = """Process the following transcript into sentence-level chunks:

**TRANSCRIPT SRT:**
{transcript}
"""

# --- Functions ---

def generate_scenes(title: str, lines: list[dict]) -> list[list[int]]:
    structured_model = model_base.with_structured_output(ScenesWithIndexGroups)
    formatted_lines = "\n".join([f"{i}: \"{line['text']}\" ({line['duration']}s)" for i, line in enumerate(lines)])

    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_SCENES_SYSTEM},
        {"role": "user", "content": GENERATE_SCENES_USER.format(title=title, formatted_lines=formatted_lines)}
    ])
    return response.scenes

def detect_characters(title: str, lines: list[dict]) -> list[Character]:
    structured_model = model_base.with_structured_output(DetectedCharacters)
    formatted_lines = "\n".join([f"{line['text']}" for line in lines])

    response = structured_model.invoke([
        {"role": "system", "content": DETECT_CHARACTERS_SYSTEM},
        {"role": "user", "content": DETECT_CHARACTERS_USER.format(title=title, formatted_lines=formatted_lines)}
    ])
    return response.characters

def generate_image_prompt(
        title: str,
        scene_lines: str,
        previous_scenes: list | None = None,
        characters: list | None = None,
        instructions: str | None = None,
):
    instructions = instructions or "No instructions provided."
    formatted_previous_scenes = "No previous scenes provided."
    formatted_characters = "No characters provided."
    
    if previous_scenes and len(previous_scenes) > 0:
        formatted_scenes = []
        # enumerate starting at 1 makes it easy for the LLM to follow chronological order
        for i, scene in enumerate(previous_scenes, start=1):
            formatted_scenes.append(
                f"--- Previous Scene {i} ---\n"
                f"- Lines: {scene.scene_lines}\n"
                f"- Prompt: {scene.prompt}"
            )
        formatted_previous_scenes = "\n\n".join(formatted_scenes)

    if characters and len(characters) > 0:
        formatted_characters = "\n".join([f"[CH{i+1}]\n- Name: {c.name}\n- Description: {c.description}" for i, c in enumerate(characters)])

    structured_model = model_base.with_structured_output(SceneImagePrompt)
    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_IMAGE_PROMPT_SYSTEM},
        {"role": "user", "content": GENERATE_IMAGE_PROMPT_USER.format(
            title=title,
            scene_lines=scene_lines,
            instructions=instructions,
            formatted_previous_scenes=formatted_previous_scenes,
            formatted_characters=formatted_characters
        )}
    ])
    return {"prompt": response.prompt}

def smart_transcript(transcript: str) -> list[TranscriptSentence]:
    structured_model = model_mass.with_structured_output(SentenceTranscript)
    response = structured_model.invoke([
        {"role": "system", "content": SMART_TRANSCRIPT_SYSTEM},
        {"role": "user", "content": SMART_TRANSCRIPT_USER.format(transcript=transcript)}
    ])
    return response.sentences