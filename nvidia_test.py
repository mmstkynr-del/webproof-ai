import os
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from openai import OpenAI

BASE_URL = "https://www.bbc.com/turkce"
MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"]
)

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}


def get_article_urls():
    response = requests.get(
        BASE_URL,
        headers=HEADERS,
        timeout=15
    )

    print(f"BBC HTTP: {response.status_code}")

    soup = BeautifulSoup(response.text, "html.parser")

    urls = []

    for a in soup.find_all("a", href=True):
        url = urljoin(BASE_URL, a["href"])
        parsed = urlparse(url)

        if parsed.netloc not in ["www.bbc.com", "bbc.com"]:
            continue

        if parsed.path.startswith("/turkce/articles/"):
            clean_url = f"https://www.bbc.com{parsed.path}"

            if clean_url not in urls:
                urls.append(clean_url)

    return urls


def extract_article(url):
    response = requests.get(
        url,
        headers=HEADERS,
        timeout=15
    )

    if response.status_code != 200:
        return None

    soup = BeautifulSoup(response.text, "html.parser")

    for tag in soup([
        "script",
        "style",
        "noscript",
        "svg",
        "nav",
        "footer",
        "header",
        "form",
        "aside",
        "iframe"
    ]):
        tag.decompose()

    main = soup.find("main")

    if not main:
        main = soup.body

    if not main:
        return None

    title = ""

    if soup.title:
        title = soup.title.get_text(" ", strip=True)

    paragraphs = []

    for p in main.find_all("p"):
        text = p.get_text(" ", strip=True)
        text = re.sub(r"\s+", " ", text)

        if len(text) >= 25:
            if text not in paragraphs:
                paragraphs.append(text)

    body = "\n\n".join(paragraphs)

    if not body:
        return None

    return {
        "title": title,
        "text": body[:12000]
    }


def analyze_with_nvidia(article):
    prompt = f"""
Sen profesyonel bir Türkçe haber editörüsün.

Aşağıdaki haber metnini kontrol et.

YALNIZCA:
- açık yazım hataları
- açık noktalama hataları
- açık dilbilgisi hataları
- bariz harf hataları
- bariz boşluk hataları

tespit et.

ÖNEMLİ KURALLAR:

1. Emin olmadığın ifadeyi HATA olarak gösterme.
2. Haber dilini gereksiz yere değiştirme.
3. Siyasi anlamı değiştirme.
4. Hukuki anlamı değiştirme.
5. Ekonomik anlamı değiştirme.
6. Kişi isimlerini değiştirme.
7. Kurum isimlerini değiştirme.
8. Yer isimlerini değiştirme.
9. Sadece açıkça hatalı olduğundan emin olduğun noktaları bildir.

Her hata için:

HATA
Orijinal: ...
Öneri: ...
Açıklama: ...

Hiç açık hata yoksa:

HATA YOK

HABER BAŞLIĞI:
{article["title"]}

HABER METNİ:
{article["text"]}
"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Sen çok dikkatli ve muhafazakâr "
                    "bir Türkçe haber editörüsün. "
                    "Yalnızca kesin hataları bildir."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.1,
        top_p=0.95,
        max_tokens=4000,
        stream=False
    )

    return response.choices[0].message.content


print("========================================")
print("WEBPROOF AI")
print("BBC + NVIDIA GERÇEK HABER TESTİ")
print("========================================")

urls = get_article_urls()

print(f"Bulunan haber bağlantısı: {len(urls)}")

urls = urls[:5]

successful = 0

for index, url in enumerate(urls, 1):

    print()
    print("========================================")
    print(f"HABER {index}/{len(urls)}")
    print("========================================")
    print(url)

    try:

        article = extract_article(url)

        if not article:
            print("Haber metni alınamadı.")
            continue

        print(f"Başlık: {article['title']}")
        print(f"Metin uzunluğu: {len(article['text'])} karakter")

        result = analyze_with_nvidia(article)

        successful += 1

        print()
        print("NVIDIA ANALİZİ")
        print("----------------------------------------")
        print(result)

    except Exception as e:

        print()
        print("HATA:")
        print(str(e))

print()
print("========================================")
print("TEST SONUCU")
print("========================================")
print(f"Başarılı analiz: {successful}")
print(f"Toplam haber: {len(urls)}")
print("========================================")
