from dotenv import load_dotenv
load_dotenv()

from langchain_groq import ChatGroq
import os
from pydantic import BaseModel, Field

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

model = ChatGroq(
    api_key=GROQ_API_KEY,
    model="llama-3.3-70b-versatile"
)

class ScenesWithIndexGroups(BaseModel):
    scenes: list[list[int]] = Field(..., description="list of list of line indices, groupped into scenes.")

class SceneImagePrompt(BaseModel):
    prompt: str = Field(..., description="A descriptive prompt for generating an image based on the scene lines.")

GENERATE_SCENES_SYSTEM = """You are a creative movie director working with an AI video generation pipeline. Lines from a script with their indices are provided to you. Your task is to group these lines into short scenes, where each scene will be represented by a single image in the video.

CRITICAL CONSTRAINTS:
- ONE SCENE = ONE IMAGE. If the visual changes even slightly, it MUST be a new scene.
- KEEP SCENES EXTREMELY SHORT. Most scenes should be 1 or 2 lines. 3 lines is the absolute maximum if they describe the exact same static visual.
- Lines that describe different actions, different subjects, or a passage of time CANNOT be in the same scene.

EXAMPLE OF DESIRED PACING:
Lines:
0: "Paris, 1925."
1: "The city is recovering from the Great War."
2: "And the Eiffel Tower is rusting."
3: "Victor Lustig sits in a luxurious hotel suite."
4: "He reads an article about the tower's high maintenance costs."
5: "A devious smile crosses his face."
6: "He has found his next mark."
7: "The French Government."

Expected Output:
[[0, 1], [2], [3, 4], [5], [6, 7]]

RULES:
- Return ONLY a valid JSON list of lists of line indices.
- Do not include any other text, formatting, or markdown blocks.
- Do not miss or repeat any index.
"""

GENERATE_SCENES_USER = """Please generate scenes for the following script:

TITLE: {title}

LINES:
{formatted_lines}
"""

GENERATE_IMAGE_PROMPT_SYSTEM = """You are a creative AI image prompt engineer. Some lines from a script, its title, and optional instructions are provided to you. Your task is to generate a descriptive image-generation prompt that represents the scene while strictly following the provided instructions. This prompt will later be used to generate an image using a text-to-image AI model.

INPUTS:
- **TITLE** (REQUIRED): The title of the script.
- **SCENE LINES** (REQUIRED): A few lines from the script that describe the current scene.
- **PREVIOUS SCENE PROMPT** (OPTIONAL): The prompt of the previous scene. Use this to maintain visual continuity and consistent character/environment details.
- **INSTRUCTIONS** (OPTIONAL): Some guidelines for style, character details, atmosphere, or any other constraints.

RULES:
- Be creative and descriptive in your prompt to ensure the generated image captures the essence of the scene.
- Ensure visual consistency with the PREVIOUS SCENE PROMPT if it is provided.
- If INSTRUCTIONS are provided, they must be heavily prioritized and incorporated into the final prompt.
- You MUST NOT have instructions to add any kind of caption or overlay text in the output image prompt.
"""

def GENERATE_IMAGE_PROMPT_USER(
        title: str,
        scene_lines: str,
        instructions: str | None = None,
        previous_prompt: str | None = None,
    ) -> str:
    prompt = f"Generate an image prompt using the following inputs:\n\n**TITLE:**\n{title}\n\n**SCENE LINES:**\n{scene_lines}"
    if previous_prompt:
        prompt += f"\n\n**PREVIOUS SCENE PROMPT:**\n{previous_prompt}"
    if instructions:
        prompt += f"\n\n**INSTRUCTIONS:**\n{instructions}"
    
    return prompt

def generate_scenes(title: str, lines: list[dict]) -> list[list[int]]:
    structured_model = model.with_structured_output(ScenesWithIndexGroups)
    formatted_lines = "\n".join([f"{i}: \"{line['text']}\"" for i, line in enumerate(lines)])

    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_SCENES_SYSTEM},
        {"role": "user", "content": GENERATE_SCENES_USER.format(title=title, formatted_lines=formatted_lines)}
    ])
    return response.scenes

def generate_image_prompt(
        title: str,
        scene_lines: str,
        instructions: str | None = None,
        previous_prompt: str | None = None
    ) -> str:
    structured_model = model.with_structured_output(SceneImagePrompt)
    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_IMAGE_PROMPT_SYSTEM},
        {"role": "user", "content": GENERATE_IMAGE_PROMPT_USER(
            title=title,
            scene_lines=scene_lines,
            instructions=instructions,
            previous_prompt=previous_prompt
        )}
    ])
    return response.prompt