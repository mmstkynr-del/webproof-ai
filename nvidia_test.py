import os
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from openai import OpenAI

# ============================================================
# WEBPROOF AI - BBC + NVIDIA
# ============================================================

BASE_URL = "https://www.bbc.com/turkce"
MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"]
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (WebProof AI)"
}


# ============================================================
# BBC HABER LİNKLERİNİ BUL
# ============================================================

def get_article_urls():

    response = requests.get(
        BASE_URL,
        headers=HEADERS,
        timeout=20
    )

    print(f"BBC HTTP: {response.status_code}")

    response.raise_for_status()

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


# ============================================================
# HABER METNİNİ TEMİZLE
# ============================================================

def extract_article(url):

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=20
    )

    if response.status_code != 200:
        print(f"Haber HTTP: {response.status_code}")
        return None

    soup = BeautifulSoup(response.text, "html.parser")

    # Gereksiz HTML bölümlerini kaldır
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

    # Ana içerik
    main = soup.find("main")

    if not main:
        main = soup.body

    if not main:
        return None

    # Başlık
    title = ""

    if soup.title:
        title = soup.title.get_text(" ", strip=True)

    # Paragrafları al
    paragraphs = []

    for p in main.find_all("p"):

        text = p.get_text(" ", strip=True)

        text = re.sub(r"\s+", " ", text)

        # Çok kısa metinleri alma
        if len(text) < 25:
            continue

        # Tekrarları kaldır
        if text not in paragraphs:
            paragraphs.append(text)

    body = "\n\n".join(paragraphs)

    if not body:
        return None

    # Maksimum metin uzunluğu
    body = body[:12000]

    return {
        "title": title,
        "text": body
    }


# ============================================================
# NVIDIA ANALİZİ
# ============================================================

def analyze_with_nvidia(article):

    prompt = f"""
Aşağıdaki Türkçe haber metnini profesyonel bir haber editörü
gibi kontrol et.

SADECE şu hataları bildir:

- Kesin yazım hataları
- Kesin noktalama hataları
- Kesin dilbilgisi hataları
- Açık harf/klavye hataları
- Açık boşluk hataları

ÇOK ÖNEMLİ:

Emin olmadığın hiçbir şeyi hata olarak bildirme.

Stil tercihi olan ifadeleri hata olarak bildirme.

Cümleyi daha güzel hale getirmek için değiştirme.

Gazetecilik üslubunu değiştirme.

Siyasi anlamı değiştirme.

Hukuki anlamı değiştirme.

Ekonomik anlamı değiştirme.

Kişi isimlerini değiştirme.

Kurum isimlerini değiştirme.

Yer isimlerini değiştirme.

Özel isimleri düzeltmeye çalışma.

Bir ifade sadece daha iyi yazılabilir diye hata olarak gösterme.

Yalnızca gerçekten yanlış olduğundan emin olduğun noktaları bildir.

ÇIKTI KURALI:

Kesin hata varsa yalnızca şu formatı kullan:

HATA
Orijinal: ...
Öneri: ...
Açıklama: ...

HATA
Orijinal: ...
Öneri: ...
Açıklama: ...

Birden fazla hata varsa aynı formatı tekrar et.

Kesin hata yoksa yalnızca:

HATA YOK

yaz.

ASLA şunları yazma:

- düşünme süreci
- analiz süreci
- reasoning
- thinking process
- adım adım değerlendirme
- "Let's analyze"
- "The user wants"
- İngilizce açıklama

SADECE nihai editör sonucunu ver.

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
                    "Sen yalnızca nihai editör sonucunu veren "
                    "profesyonel bir Türkçe haber editörüsün. "
                    "İç düşünme veya reasoning metni üretme. "
                    "Sadece kesin hataları bildir."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],

        temperature=0.1,

        top_p=0.9,

        max_tokens=3000,

        stream=False,

        extra_body={
            "chat_template_kwargs": {
                "enable_thinking": False
            }
        }
    )

    return response.choices[0].message.content


# ============================================================
# ANA PROGRAM
# ============================================================

print()
print("========================================")
print("WEBPROOF AI")
print("BBC + NVIDIA GERÇEK HABER TESTİ")
print("========================================")
print()

try:

    urls = get_article_urls()

    print(f"Bulunan haber bağlantısı: {len(urls)}")

    # Şimdilik sadece 5 haber
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
                print("❌ Haber metni alınamadı.")
                continue

            print(f"Başlık: {article['title']}")
            print(f"Metin uzunluğu: {len(article['text'])} karakter")

            print()
            print("NVIDIA analiz ediyor...")

            result = analyze_with_nvidia(article)

            successful += 1

            print()
            print("NVIDIA SONUCU")
            print("----------------------------------------")
            print(result)

        except Exception as e:

            error_text = str(e)

            print()
            print("❌ NVIDIA/HABER HATASI")
            print("----------------------------------------")
            print(error_text)

            if "429" in error_text:

                print()
                print("⚠️ NVIDIA kota/limit nedeniyle bu haber analiz edilemedi.")

            elif "410" in error_text:

                print()
                print("⚠️ NVIDIA modeli artık kullanılamıyor.")

    print()
    print("========================================")
    print("TEST SONUCU")
    print("========================================")
    print(f"Başarılı analiz: {successful}")
    print(f"Toplam haber: {len(urls)}")
    print("========================================")

except Exception as e:

    print()
    print("========================================")
    print("❌ GENEL HATA")
    print("========================================")
    print(str(e))
