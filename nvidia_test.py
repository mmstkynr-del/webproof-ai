import os
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from openai import OpenAI

# ============================================================
# WEBPROOF AI - GELİŞMİŞ KURAL MOTORU + NVIDIA
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
# KURAL MOTORU
# ============================================================

def rule_check(text):

    errors = []

    # --------------------------------------------------------
    # ANALİZ DIŞI BÖLGELER
    #
    # URL, e-posta, kod vb. bölümleri koruyoruz.
    # --------------------------------------------------------

    protected = []

    def protect(match):
        protected.append(match.group(0))
        return f"___WEBPROOF_PROTECTED_{len(protected)-1}___"

    working_text = re.sub(
        r"https?://[^\s]+|www\.[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}",
        protect,
        text
    )

    # --------------------------------------------------------
    # 1. NOKTALAMA İŞARETİNDEN ÖNCE GEREKSİZ BOŞLUK
    #
    # Örnek:
    # "söylemişti ." -> "söylemişti."
    #
    # Ancak:
    # ". . ." gibi yapıları ve URL'leri koruyoruz.
    # --------------------------------------------------------

    pattern = r"(?<!\.)\s+([,!?;:])"

    for match in re.finditer(pattern, working_text):

        original = match.group(0)
        punctuation = match.group(1)

        errors.append({
            "type": "noktalama öncesi boşluk",
            "original": original,
            "suggestion": punctuation,
            "context": get_context(
                working_text,
                match.start(),
                match.end()
            )
        })

    # --------------------------------------------------------
    # 2. NOKTALAMA SONRASI EKSİK BOŞLUK
    #
    # ".Merhaba" -> ". Merhaba"
    #
    # ÖNEMLİ:
    # .M / .S gibi baş harfli kişi kısaltmalarını atlıyoruz.
    # --------------------------------------------------------

    pattern = r"([.!?,;:])([A-Za-zÇĞİÖŞÜçğıöşü])"

    for match in re.finditer(pattern, working_text):

        punctuation = match.group(1)
        letter = match.group(2)

        # Kişi baş harfi:
        # Ö.M.
        # Ö.S.
        # A.B.
        if punctuation == "." and letter.isupper():

            before = working_text[max(0, match.start()-2):match.start()]

            if re.search(
                r"[A-ZÇĞİÖŞÜ]\.",
                before
            ):
                continue

        # Kısaltma benzeri durumlar
        if punctuation == "." and letter.isupper():
            continue

        errors.append({
            "type": "noktalama sonrası eksik boşluk",
            "original": match.group(0),
            "suggestion": punctuation + " " + letter,
            "context": get_context(
                working_text,
                match.start(),
                match.end()
            )
        })

    # --------------------------------------------------------
    # 3. KELİME + SAYI BİRLEŞMESİ
    #
    # araçlarının10 -> araçlarının 10
    # --------------------------------------------------------

    pattern = r"([A-Za-zÇĞİÖŞÜçğıöşü])(\d+)"

    for match in re.finditer(pattern, working_text):

        original = match.group(0)

        letter = match.group(1)
        number = match.group(2)

        # Tarih benzeri yapıları atla
        if re.search(
            r"\d{1,4}$",
            number
        ):

            # Yıl gibi 2026 vb.
            if len(number) == 4:
                continue

        errors.append({
            "type": "kelime-sayı birleşmesi",
            "original": original,
            "suggestion": letter + " " + number,
            "context": get_context(
                working_text,
                match.start(),
                match.end()
            )
        })

    # --------------------------------------------------------
    # 4. SAYI + KELİME BİRLEŞMESİ
    #
    # 10kişi -> 10 kişi
    # --------------------------------------------------------

    pattern = r"(\d)([A-Za-zÇĞİÖŞÜçğıöşü])"

    for match in re.finditer(pattern, working_text):

        number = match.group(1)
        letter = match.group(2)

        # Saatleri koru
        before = working_text[
            max(0, match.start()-3):
            match.start()+3
        ]

        if ":" in before:
            continue

        errors.append({
            "type": "sayı-kelime birleşmesi",
            "original": match.group(0),
            "suggestion": number + " " + letter,
            "context": get_context(
                working_text,
                match.start(),
                match.end()
            )
        })

    # --------------------------------------------------------
    # 5. YURT DIŞI YAZIMI
    # --------------------------------------------------------

    patterns = [
        (r"\byurtdışına\b", "yurt dışına"),
        (r"\byurtdışında\b", "yurt dışında"),
        (r"\byurtdışından\b", "yurt dışından"),
        (r"\byurtdışı\b", "yurt dışı")
    ]

    for pattern, suggestion in patterns:

        for match in re.finditer(
            pattern,
            working_text,
            flags=re.IGNORECASE
        ):

            errors.append({
                "type": "kesin yazım hatası",
                "original": match.group(0),
                "suggestion": suggestion,
                "context": get_context(
                    working_text,
                    match.start(),
                    match.end()
                )
            })

    # --------------------------------------------------------
    # 6. PARAGRAF BOŞLUKLARI KONTROL EDİLMİYOR
    #
    # \n\n normaldir.
    #
    # Önceki sürümdeki 100+ sahte bulgunun ana nedeni buydu.
    # --------------------------------------------------------

    # --------------------------------------------------------
    # KORUNAN URL / E-POSTALARI GERİ KOY
    # --------------------------------------------------------

    for index, original in enumerate(protected):

        working_text = working_text.replace(
            f"___WEBPROOF_PROTECTED_{index}___",
            original
        )

    return remove_duplicate_errors(errors)


# ============================================================
# BAĞLAM AL
# ============================================================

def get_context(text, start, end):

    context_start = max(
        0,
        start - 70
    )

    context_end = min(
        len(text),
        end + 70
    )

    context = text[
        context_start:context_end
    ]

    context = re.sub(
        r"\s+",
        " ",
        context
    )

    return context.strip()


# ============================================================
# AYNI HATALARI TEKRAR ETME
# ============================================================

def remove_duplicate_errors(errors):

    unique = []

    seen = set()

    for error in errors:

        key = (
            error["type"],
            error["original"],
            error["suggestion"],
            error["context"]
        )

        if key in seen:
            continue

        seen.add(key)

        unique.append(error)

    return unique


# ============================================================
# BBC HABER LİNKLERİNİ BUL
# ============================================================

def get_article_urls():

    response = requests.get(
        BASE_URL,
        headers=HEADERS,
        timeout=20
    )

    print(
        f"BBC HTTP: {response.status_code}"
    )

    response.raise_for_status()

    soup = BeautifulSoup(
        response.text,
        "html.parser"
    )

    urls = []

    for a in soup.find_all(
        "a",
        href=True
    ):

        url = urljoin(
            BASE_URL,
            a["href"]
        )

        parsed = urlparse(url)

        if parsed.netloc not in [
            "www.bbc.com",
            "bbc.com"
        ]:
            continue

        if parsed.path.startswith(
            "/turkce/articles/"
        ):

            clean_url = (
                f"https://www.bbc.com"
                f"{parsed.path}"
            )

            if clean_url not in urls:

                urls.append(
                    clean_url
                )

    return urls


# ============================================================
# HABER METNİNİ ÇIKAR
# ============================================================

def extract_article(url):

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=20
    )

    if response.status_code != 200:

        print(
            f"Haber HTTP: "
            f"{response.status_code}"
        )

        return None

    soup = BeautifulSoup(
        response.text,
        "html.parser"
    )

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

            paragraphs.append(
                text
            )

    body = "\n\n".join(
        paragraphs
    )

    if not body:

        return None

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
                    "Sen profesyonel bir Türkçe "
                    "haber editörüsün. "
                    "Sadece nihai sonucu ver. "
                    "İç düşünme veya reasoning "
                    "üretme."
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
print("GELİŞMİŞ KURAL MOTORU + NVIDIA")
print("========================================")
print()

try:

    urls = get_article_urls()

    print(
        f"Bulunan haber bağlantısı: "
        f"{len(urls)}"
    )

    urls = urls[:5]

    successful = 0

    total_rule_errors = 0

    for index, url in enumerate(
        urls,
        1
    ):

        print()
        print("========================================")

        print(
            f"HABER "
            f"{index}/{len(urls)}"
        )

        print("========================================")

        print(url)

        try:

            article = extract_article(
                url
            )

            if not article:

                print(
                    "❌ Haber metni alınamadı."
                )

                continue

            print(
                f"Başlık: "
                f"{article['title']}"
            )

            print(
                f"Metin uzunluğu: "
                f"{len(article['text'])} karakter"
            )

            # ------------------------------------------------
            # KURAL MOTORU
            # ------------------------------------------------

            print()
            print(
                "Kural motoru çalışıyor..."
            )

            rule_errors = rule_check(
                article["text"]
            )

            total_rule_errors += len(
                rule_errors
            )

            print(
                "Kural motoru bulduğu hata: "
                f"{len(rule_errors)}"
            )

            if rule_errors:

                print()
                print(
                    "KURAL MOTORU SONUÇLARI"
                )

                print(
                    "----------------------------------------"
                )

                for error in rule_errors:

                    print(
                        f"Tür: "
                        f"{error['type']}"
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

                    print(
                        "----------------------------------------"
                    )

            # ------------------------------------------------
            # NVIDIA
            # ------------------------------------------------

            print()
            print(
                "NVIDIA analiz ediyor..."
            )

            result = analyze_with_nvidia(
                article
            )

            successful += 1

            print()
            print(
                "NVIDIA SONUCU"
            )

            print(
                "----------------------------------------"
            )

            print(result)

        except Exception as e:

            error_text = str(e)

            print()
            print("❌ HATA")

            print(
                "----------------------------------------"
            )

            print(error_text)

            if "429" in error_text:

                print()
                print(
                    "⚠️ NVIDIA kota/limit "
                    "nedeniyle analiz yapılamadı."
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
