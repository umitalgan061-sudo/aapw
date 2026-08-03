import requests
import os
from dotenv import load_dotenv

load_dotenv()

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")

if not NVIDIA_API_KEY:
    raise SystemExit("NVIDIA_API_KEY bulunamadı. .env dosyasını kontrol et.")

headers = {
    "Authorization": f"Bearer {NVIDIA_API_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# ---------- 1) NVIDIA Embedding ----------
embed_url = "https://integrate.api.nvidia.com/v1/embeddings"

embed_payload = {
    "model": "nvidia/nemotron-3-embed-1b",
    "input": ["örnek metin veya veri"],
    "input_type": "query",          # sorgu için query, doküman için passage
    "encoding_format": "float",
}

embed_response = requests.post(embed_url, headers=headers, json=embed_payload)
print("Embedding Status:", embed_response.status_code)

embed_data = embed_response.json()

if embed_response.status_code != 200:
    print("Embedding hata:", embed_data)
    raise SystemExit()

embedding_len = len(embed_data["data"][0]["embedding"])
print("Embedding boyutu:", embedding_len)

# ---------- 2) NVIDIA LLM (Claude yerine) ----------
chat_url = "https://integrate.api.nvidia.com/v1/chat/completions"

chat_payload = {
    "model": "meta/llama-3.1-8b-instruct",
    "messages": [
        {
            "role": "user",
            "content": (
                f"NVIDIA embedding modeli çalıştı.\n"
                f"Model: nvidia/nemotron-3-embed-1b\n"
                f"Embedding boyutu: {embedding_len}\n\n"
                f"Bu ne anlama geliyor, kısaca teknik olarak yorumla. "
                f"Bir GitHub projesinde (ör. web/PWA) bu embedding nasıl kullanılabilir?"
            ),
        }
    ],
    "max_tokens": 512,
    "temperature": 0.3,
}

chat_response = requests.post(chat_url, headers=headers, json=chat_payload)
print("\nLLM Status:", chat_response.status_code)

chat_data = chat_response.json()

if chat_response.status_code == 200:
    # OpenAI uyumlu yanıt formatı
    text = chat_data["choices"][0]["message"]["content"]
    print("LLM yanıtı:\n", text)
else:
    print("LLM hata:", chat_data)