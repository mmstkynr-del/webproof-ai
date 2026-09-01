import os
from openai import OpenAI

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"]
)

response = client.chat.completions.create(
    model="nvidia/nemotron-3.5-lightning-30b-a3b",
    messages=[
        {
            "role": "system",
            "content": "Sen profesyonel Türkçe haber editörüsün."
        },
        {
            "role": "user",
            "content": """
Aşağıdaki cümleyi Türkçe yazım, noktalama ve açık dilbilgisi
hataları açısından kontrol et.

Cümle:
"Türkiye Avrupa Voleybol Şampiyonasında Azerbaycanı eleyerek çeyrek finale çıktı."

Yalnızca açık hataları bildir.

Format:

Orijinal:
Öneri:
Açıklama:
"""
        }
    ],
    temperature=0.1,
    max_tokens=1000,
    stream=False
)

print("========================================")
print("WEBPROOF AI - NVIDIA BAŞARILI")
print("========================================")
print(response.choices[0].message.content)
