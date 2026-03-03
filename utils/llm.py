from dotenv import load_dotenv
load_dotenv()

from langchain_groq import ChatGroq
import os
import re
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

class Character(BaseModel):
    name: str = Field(..., description="The name of the character.")
    description: str = Field(..., description="One line description about the role of character in the story.")

class DetectedCharacters(BaseModel):
    characters: list[Character] = Field(..., description="A list of characters detected in the story.")

GENERATE_SCENES_SYSTEM = """You are a creative animator working on a story. Lines from a script with their indices are provided to you. Your task is to group these lines into scenes.

RULES:
- Lines fitting in a single background, character and other settings belongs to the same scene.
- If any of these changes, a new scene should be created.
- Focus on creating short meaningful scenes (generally 1-2 lines) rather than longer ones.

- Return ONLY a valid JSON list of lists of line indices.
- Do not miss or repeat any index.

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
[[0, 1], [2], [3, 4, 5], [6, 7]]
"""

GENERATE_SCENES_USER = """Please generate scenes for the following script:

TITLE: {title}

LINES:
{formatted_lines}
"""

GENERATE_IMAGE_PROMPT_SYSTEM = """You are a creative AI image prompt engineer. A story title, some lines from a scene, previous scene details, instructions and a list of characters are provided to you. Your task is to generate a descriptive image-generation prompt that represents the scene meaningfully following the provided instructions. This prompt will later be used to generate an image using a text-to-image AI model.

INPUTS:
- **TITLE** (REQUIRED): The title of the story.
- **SCENE LINES** (REQUIRED): A few lines from the script that describe the current scene.
- **PREVIOUS SCENE** (OPTIONAL): Details on the previous scene.
- **CHARACTERS** (OPTIONAL): A list of characters present in the story with their name and descriptions.
- **INSTRUCTIONS** (OPTIONAL): Some guidelines for style, character details, atmosphere, or any other constraints.

RULES:
- If previous scene and current one seems to be a continuation, ensure continuity of the generated image prompt with the previous scene's prompt.
- To include a character in the prompt from given list, you use a special notation **[CHX]** where X is the index of the character in the provided character list (starting from 1). For example, if you want to include the first character from the list, you would use [CH1] in your prompt.
- All the characters present in the whole story is provided to you, but you include only the characters that are required in current scene.
- If there is no characters in the scene, you just ignore the provided character list.
- If there is a character required in the scene which is not provided in the character list, you MUST NOT write a character notation for it. Instead you should describe the character in the prompt with words.
- Follow the instructions provided to you strictly.
"""

GENERATE_IMAGE_PROMPT_USER = """Generate an image prompt using the following inputs:
**TITLE:** {title}

**SCENE LINES:**
{scene_lines}

**PREVIOUS SCENE:**
{formatted_previous_scene}

**CHARACTERS:**
{formatted_characters}

**INSTRUCTIONS:**
{instructions}
"""


DETECT_CHARACTERS_SYSTEM = """You are a professional animation artist working on a story. Lines from a script are provided to you. Your task is to find out the main characters from the story and return a list.

RULES:
- Characters that appear only once or twice can be safely ignored.
- Mass characters like "CROWD", "PEOPLE", "ONLOOKERS" should be ignored.
- The description of character should be a simple one line identification. For example, "The main character", "Father of the main character" etc.
"""

DETECT_CHARACTERS_USER = """Please find the main characters for the following script:
TITLE: {title}

LINES:
{formatted_lines}
"""

def generate_scenes(title: str, lines: list[dict]) -> list[list[int]]:
    structured_model = model.with_structured_output(ScenesWithIndexGroups)
    formatted_lines = "\n".join([f"{i}: \"{line['text']}\"" for i, line in enumerate(lines)])

    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_SCENES_SYSTEM},
        {"role": "user", "content": GENERATE_SCENES_USER.format(title=title, formatted_lines=formatted_lines)}
    ])
    return response.scenes

def detect_characters(title: str, lines: list[dict]) -> list[Character]:
    structured_model = model.with_structured_output(DetectedCharacters)
    formatted_lines = "\n".join([f"{line['text']}" for line in lines])

    response = structured_model.invoke([
        {"role": "system", "content": DETECT_CHARACTERS_SYSTEM},
        {"role": "user", "content": DETECT_CHARACTERS_USER.format(title=title, formatted_lines=formatted_lines)}
    ])
    return response.characters

def generate_image_prompt(
        title: str,
        scene_lines: str,
        previous_scene: dict | None = None,
        characters: list | None = None,
        instructions: str | None = None,
):
    instructions = instructions or "No instructions."
    formatted_previous_scene = "No previous scene available."
    if previous_scene:
        formatted_previous_scene = f"- Scene Lines: {previous_scene.get('lines', 'N/A')}\n- Generated Prompt: {previous_scene.get('prompt', 'N/A')}"
    formatted_characters = "No characters."
    if characters and len(characters) > 0:
        formatted_characters = "\n".join([f"[CH{i+1}]\n- Name: {c.name}\n- Description: {c.description}" for i, c in enumerate(characters)])

    structured_model = model.with_structured_output(SceneImagePrompt)
    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_IMAGE_PROMPT_SYSTEM},
        {"role": "user", "content": GENERATE_IMAGE_PROMPT_USER.format(
            title=title,
            scene_lines=scene_lines,
            instructions=instructions,
            formatted_previous_scene=formatted_previous_scene,
            formatted_characters=formatted_characters
        )}
    ])
    return {"prompt": response.prompt}