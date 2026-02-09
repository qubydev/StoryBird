from dotenv import load_dotenv
load_dotenv()

from langchain_groq import ChatGroq
import os
from pydantic import BaseModel, Field

# Definations 
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

model = ChatGroq(
    api_key=GROQ_API_KEY,
    model="llama-3.3-70b-versatile"
)

# Models
class ScenesWithIndexGroups(BaseModel):
    scenes: list[list[int]] = Field(..., description="A list of scenes, where each scene is a list of sentence indices.")

class SceneImagePrompt(BaseModel):
    prompt: str = Field(..., description="A descriptive prompt for generating an image based on the scene sentences.")

# Prompts
GENERATE_SCENES_SYSTEM = """You are a creative documentry writer. A documentry with all the sentences is given with their indices and duration. Your task is to group these sentences into small scenes and return a list of list of sentence indices.

RULES:
- Each scene should be approximately 5-8s long.
- Return only the list of list of sentence indices, without any additional text.
- Do not miss or repeate any index.
"""

GENERATE_SCENES_USER = """Please generate scenes for the following documentry:

TITLE: {title}

SENTENCES:
{formatted_sentences}
"""

GENERATE_IMAGE_PROMPT_SYSTEM = """You are a creative AI image prompt engineer.

Your task is to generate a descriptive image-generation prompt based on the provided scene and other input.

You may be given:
- Scene (always present)
- A character description (optional)
- A visual style (optional)
- Previous scene context (optional)

RULES:
- Faithfully represent the given scene.
- If a character description is provided, incorporate it clearly.
- If a visual style is provided, apply it consistently.
- If previous scene context is provided, ensure visual continuity.
"""

def GENERATE_IMAGE_PROMPT_USER(
    scene_sentences: str,
    previous_scene_context: str | None = None,
    character_description: str | None = None,
    style: str | None = None,
) -> str:
    prompt = f"Generate an image prompt for the following scene:\n\nScene Sentences:\n{scene_sentences}\n\n"
    if character_description:
        prompt += f"Character Description:\n{character_description}\n\n"
    if style:
        prompt += f"Visual Style:\n{style}\n\n"
    if previous_scene_context:
        prompt += f"Previous Scene Context:\n{previous_scene_context}\n\n"
    return prompt

# Functions 
def generate_scenes(sentences: list[dict]) -> list[list[int]]:
    structured_model = model.with_structured_output(ScenesWithIndexGroups)
    formatted_sentences = "\n".join([f"{i}: \"{sentence['text']}\" ({round(sentence['duration'], 2)}s)" for i, sentence in enumerate(sentences)])
    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_SCENES_SYSTEM},
        {"role": "user", "content": GENERATE_SCENES_USER.format(title="Documentry Title", formatted_sentences=formatted_sentences)}
    ])
    return response.scenes

def generate_image_prompt(
        scene_sentences: str,
        previous_scene_context: str | None = None,
        character_description: str | None = None,
        style: str | None = None
    ) -> str:
    structured_model = model.with_structured_output(SceneImagePrompt)
    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_IMAGE_PROMPT_SYSTEM},
        {"role": "user", "content": GENERATE_IMAGE_PROMPT_USER(
            scene_sentences=scene_sentences,
            previous_scene_context=previous_scene_context,
            character_description=character_description,
            style=style,
        ).strip()}
    ])
    return response.prompt
    