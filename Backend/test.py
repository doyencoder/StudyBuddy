import os
from dotenv import load_dotenv

load_dotenv()

print("HF TOKEN:", os.getenv("HF_API_TOKEN"))
print("GOOGLE KEY:", os.getenv("GOOGLE_API_KEY"))