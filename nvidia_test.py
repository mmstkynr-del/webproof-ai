import os
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from openai import OpenAI

# ============================================================
# WEBPROOF AI - KURAL MOTORU + NVIDIA
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
# 1. KURAL MOTORU
# ============================================================

def rule_check(text):

    errors = []

    # --------------------------------------------------------
    # A) Noktalama işaretinden ÖNCE gereksiz boşluk
    # --------------------------------------------------------

    pattern = r"\s+([,.!?;:])"

    for match in re.finditer(pattern, text):

        original = match.group(0)
        punctuation = match.group(1)

        start = max(0, match.start() - 60)
        end = min(len(text), match.end() + 60)

        context = text[start:end]

        errors.append({
            "type": "boşluk",
            "original": original,
            "suggestion": punctuation,
            "context": context
        })

    # --------------------------------------------------------
    # B) Noktalama işaretinden SONRA eksik boşluk
    # --------------------------------------------------------

    pattern = r"([,.!?;:])([A-Za-zÇĞİÖŞÜçğıöşü])"

    for match in re.finditer(pattern, text):

        punctuation = match.group(1)
        letter = match.group(2)

        # Ondalık sayı gibi durumları atla
        if punctuation == "," and letter.isdigit():
            continue

        original = match.group(0)
        suggestion = punctuation + " " + letter

        start = max(0, match.start() - 60)
        end = min(len(text), match.end() + 60)

        context = text[start:end]

        errors.append({
            "type": "eksik boşluk",
            "original": original,
            "suggestion": suggestion,
            "context": context
        })

    # --------------------------------------------------------
    # C) Sayı + kelime birleşmesi
    # Örnek: araçlarının10 → araçlarının 10
    # --------------------------------------------------------

    pattern = r"([A-Za-zÇĞİÖŞÜçğıöşü])(\d+)"

    for match in re.finditer(pattern, text):

        original = match.group(0)

        # Tarih, saat ve benzeri yaygın yapıları atla
        if re.search(r"\d{1,2}:\d{2}", original):
            continue

        letter = match.group(1)
        number = match.group(2)

        suggestion = letter + " " + number

        start = max(0, match.start() - 60)
        end = min(len(text), match.end() + 60)

        context = text[start:end]

        errors.append({
            "type": "kelime-sayı birleşmesi",
            "original": original,
            "suggestion": suggestion,
            "context": context
        })

    # --------------------------------------------------------
    # D) Sayı + kelime arasında eksik boşluk
    # Örnek: 10kişi → 10 kişi
    # --------------------------------------------------------

    pattern = r"(\d)([A-Za-zÇĞİÖŞÜçğıöşü])"

    for match in re.finditer(pattern, text):

        original = match.group(0)

        # Saatleri atla
        if re.search(r"\d:\d", original):
            continue

        number = match.group(1)
        letter = match.group(2)

        suggestion = number + " " + letter

        start = max(0, match.start() - 60)
        end = min(len(text), match.end() + 60)

        context = text[start:end]

        errors.append({
            "type": "sayı-kelime birleşmesi",
            "original": original,
            "suggestion": suggestion,
            "context": context
        })

    # --------------------------------------------------------
    # E) Türkçede "yurt dışı" / "yurt dışına" vb.
    # --------------------------------------------------------

    patterns = {
        r"\byurtdışı\b": "yurt dışı",
        r"\byurtdışına\b": "yurt dışına",
        r"\byurtdışında\b": "yurt dışında",
        r"\byurtdışından\b": "yurt dışından"
    }

    for pattern, suggestion in patterns.items():

        for match in re.finditer(pattern, text, flags=re.IGNORECASE):

            original = match.group(0)

            start = max(0, match.start() - 60)
            end = min(len(text), match.end() + 60)

            context = text[start:end]

            errors.append({
                "type": "yazım",
                "original": original,
                "suggestion": suggestion,
                "context": context
            })

    # --------------------------------------------------------
    # F) Kesin boşluk hataları
    # --------------------------------------------------------

    pattern = r"\s{2,}"

    for match in re.finditer(pattern, text):

        original = match.group(0)

        start = max(0, match.start() - 60)
        end = min(len(text), match.end() + 60)

        context = text[start:end]

        errors.append({
            "type": "fazla boşluk",
            "original": original,
            "suggestion": " ",
            "context": context
        })

    return errors


# ============================================================
# 2. BBC HABER LİNKLERİNİ BUL
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
# 3. HABER METNİNİ ÇIKAR
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

        title = soup.title.get_text(
            " ",
            strip=True
        )

    paragraphs = []

    for p in main.find_all("p"):

        text = p.get_text(
            " ",
            strip=True
        )

        text = re.sub(
            r"\s+",
            " ",
            text
        )

        if len(text) < 25:
            continue

        if text not in paragraphs:
            paragraphs.append(text)

    body = "\n\n".join(paragraphs)

    if not body:
        return None

    body = body[:12000]

    return {
        "title": title,
        "text": body
    }


# ============================================================
# 4. NVIDIA ANALİZİ
# ============================================================

def analyze_with_nvidia(article):

    prompt = f"""
Aşağıdaki Türkçe haber metnini profesyonel bir Türkçe
haber editörü olarak kontrol et.

SADECE KESİN OLDUĞUNDAN EMİN OLDUĞUN HATALARI BUL.

Kontrol et:

- Kesin yazım hataları
- Kesin dilbilgisi hataları
- Kesin noktalama hataları
- Açık harf/klavye hataları
- Açık boşluk hataları

ÇOK ÖNEMLİ:

Emin olmadığın hiçbir şeyi hata olarak bildirme.

Stil tercihini hata olarak bildirme.

Cümleyi daha güzel hale getirmek için değiştirme.

Anlamı değiştirme.

Kişi isimlerini değiştirme.

Kurum isimlerini değiştirme.

Yer isimlerini değiştirme.

Özel isimleri değiştirme.

Siyasi ifadeleri değiştirme.

Gazetecilik üslubunu değiştirme.

Sadece gerçekten yanlış olduğundan emin olduğun
hataları bildir.

ÇIKTI FORMATI:

Hata varsa:

HATA
Orijinal: ...
Öneri: ...
Açıklama: ...

HATA
Orijinal: ...
Öneri: ...
Açıklama: ...

Kesin hata yoksa:

HATA YOK

SADECE nihai sonucu ver.

Düşünme süreci yazma.
Reasoning yazma.
Thinking process yazma.
İngilizce açıklama yazma.

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
                    "Sen profesyonel bir Türkçe haber "
                    "editörüsün. Sadece nihai sonucu ver. "
                    "İç düşünme veya reasoning üretme."
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
# 5. ANA PROGRAM
# ============================================================

print()
print("========================================")
print("WEBPROOF AI")
print("KURAL MOTORU + NVIDIA")
print("========================================")
print()

try:

    urls = get_article_urls()

    print(
        f"Bulunan haber bağlantısı: {len(urls)}"
    )

    urls = urls[:5]

    successful = 0
    total_rule_errors = 0

    for index, url in enumerate(urls, 1):

        print()
        print("========================================")
        print(
            f"HABER {index}/{len(urls)}"
        )
        print("========================================")

        print(url)

        try:

            article = extract_article(url)

            if not article:

                print("❌ Haber metni alınamadı.")

                continue

            print(
                f"Başlık: {article['title']}"
            )

            print(
                f"Metin uzunluğu: "
                f"{len(article['text'])} karakter"
            )

            # ------------------------------------------------
            # KURAL MOTORU
            # ------------------------------------------------

            print()
            print("Kural motoru çalışıyor...")

            rule_errors = rule_check(
                article["text"]
            )

            total_rule_errors += len(rule_errors)

            print(
                f"Kural motoru bulduğu hata: "
                f"{len(rule_errors)}"
            )

            if rule_errors:

                print()
                print("KURAL MOTORU SONUÇLARI")
                print("----------------------------------------")

                for error in rule_errors:

                    print(
                        f"Tür: {error['type']}"
                    )

                    print(
                        f"Orijinal: "
                        f"{error['original']}"
                    )

                    print(
                        f"Öneri: "
                        f"{error['suggestion']}"
                    )

                    print(
                        f"Bağlam: "
                        f"{error['context']}"
                    )

                    print("----------------------------------------")

            # ------------------------------------------------
            # NVIDIA
            # ------------------------------------------------

            print()
            print("NVIDIA analiz ediyor...")

            result = analyze_with_nvidia(
                article
            )

            successful += 1

            print()
            print("NVIDIA SONUCU")
            print("----------------------------------------")

            print(result)

        except Exception as e:

            error_text = str(e)

            print()
            print("❌ HATA")
            print("----------------------------------------")

            print(error_text)

            if "429" in error_text:

                print()
                print(
                    "⚠️ NVIDIA kota/limit nedeniyle "
                    "analiz yapılamadı."
                )

            elif "410" in error_text:

                print()
                print(
                    "⚠️ NVIDIA modeli artık "
                    "kullanılamıyor."
                )

    print()
    print("========================================")
    print("TEST SONUCU")
    print("========================================")

    print(
        f"Başarılı NVIDIA analiz: "
        f"{successful}"
    )

    print(
        f"Toplam haber: "
        f"{len(urls)}"
    )

    print(
        f"Toplam kural motoru bulgusu: "
        f"{total_rule_errors}"
    )

    print("========================================")

except Exception as e:

    print()
    print("========================================")
    print("❌ GENEL HATA")
    print("========================================")

    print(str(e))
