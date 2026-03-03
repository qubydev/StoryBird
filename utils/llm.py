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

GENERATE_IMAGE_PROMPT_SYSTEM = """You are a creative AI image prompt engineer. Some lines from a script, its title, and optional instructions are provided to you. Your task is to generate a descriptive image-generation prompt that represents the scene while strictly following the provided instructions. This prompt will later be used to generate an image using a text-to-image AI model.

INPUTS:
- **TITLE** (REQUIRED): The title of the script.
- **SCENE LINES** (REQUIRED): A few lines from the script that describe the current scene.
- **CHARACTERS** (OPTIONAL): A numbered list of characters present in the project.
- **PREVIOUS SCENE PROMPT** (OPTIONAL): The prompt of the previous scene. Use this to maintain visual continuity and consistent character/environment details.
- **INSTRUCTIONS** (OPTIONAL): Some guidelines for style, character details, atmosphere, or any other constraints.

RULES:
- Be creative and descriptive in your prompt to ensure the generated image captures the essence of the scene.
- Ensure visual consistency with the PREVIOUS SCENE PROMPT if it is provided.
- If INSTRUCTIONS are provided, they must be heavily prioritized and incorporated into the final prompt.
- Do not add any instruction to add any type of caption text in the output image.
- CRITICAL CHARACTER RULE: If CHARACTERS are provided and any of those characters appear in this scene, you MUST refer to them using ONLY their tag (e.g., [CH1], [CH2]) in the prompt. Do not write their names or describe their physical appearance if a tag is used.
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

def GENERATE_IMAGE_PROMPT_USER(
        title: str,
        scene_lines: str,
        instructions: str | None = None,
        previous_prompt: str | None = None,
        formatted_characters: str | None = None,
    ) -> str:
    prompt = f"Generate an image prompt using the following inputs:\n\n**TITLE:**\n{title}\n\n**SCENE LINES:**\n{scene_lines}"
    
    if formatted_characters:
        prompt += f"\n\n**CHARACTERS:**\n{formatted_characters}"
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
        previous_prompt: str | None = None,
        characters: list | None = None
    ) -> dict:
    
    formatted_characters = None
    if characters and len(characters) > 0:
        formatted_characters = "\n".join([f"CH{i+1}: {c.description}" for i, c in enumerate(characters)])

    structured_model = model.with_structured_output(SceneImagePrompt)
    response = structured_model.invoke([
        {"role": "system", "content": GENERATE_IMAGE_PROMPT_SYSTEM},
        {"role": "user", "content": GENERATE_IMAGE_PROMPT_USER(
            title=title,
            scene_lines=scene_lines,
            instructions=instructions,
            previous_prompt=previous_prompt,
            formatted_characters=formatted_characters
        )}
    ])
    
    raw_prompt = response.prompt
    final_prompt = raw_prompt
    subject_media_ids = []
    
    # Process the [CHX] tags into FIRST_CHARACTER, SECOND_CHARACTER and collect media IDs
    if characters and len(characters) > 0:
        ordinals = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH']
        counter = 0
        
        def replacer(match):
            nonlocal counter
            try:
                char_idx = int(match.group(1)) - 1
                if 0 <= char_idx < len(characters):
                    subject_media_ids.append(characters[char_idx].mediaId)
                    word = (ordinals[counter] if counter < len(ordinals) else 'EXTRA') + '_CHARACTER'
                    counter += 1
                    return word
            except ValueError:
                pass
            return match.group(0)

        final_prompt = re.sub(r'\[CH(\d+)\]', replacer, raw_prompt)

    return {
        "prompt": final_prompt,
        "subject_media_ids": subject_media_ids
    }

def detect_characters(title: str, lines: list[dict]) -> list[Character]:
    structured_model = model.with_structured_output(DetectedCharacters)
    formatted_lines = "\n".join([f"{line['text']}" for line in lines])

    response = structured_model.invoke([
        {"role": "system", "content": DETECT_CHARACTERS_SYSTEM},
        {"role": "user", "content": DETECT_CHARACTERS_USER.format(title=title, formatted_lines=formatted_lines)}
    ])
    return response.characters