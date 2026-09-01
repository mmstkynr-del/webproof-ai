import os
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from openai import OpenAI


# ============================================================
# WEBPROOF AI
# GELİŞMİŞ KURAL MOTORU + NVIDIA
# ÇIKTI KONTROLLÜ SÜRÜM
# ============================================================

BASE_URL = "https://www.bbc.com/turkce"

MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"

MAX_ARTICLES = 5

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"]
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (WebProof AI)"
}


# ============================================================
# BAĞLAM
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
# TEKRARLARI TEMİZLE
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
# KURAL MOTORU
# ============================================================

def rule_check(text):

    errors = []

    protected = []

    # --------------------------------------------------------
    # URL / E-MAIL KORUMA
    # --------------------------------------------------------

    def protect(match):

        protected.append(
            match.group(0)
        )

        return (
            f"___WEBPROOF_URL_"
            f"{len(protected)-1}___"
        )

    working_text = re.sub(
        r"https?://[^\s]+|www\.[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}",
        protect,
        text
    )

    # --------------------------------------------------------
    # 1. NOKTALAMA ÖNCESİ BOŞLUK
    #
    # "burada ." -> "burada."
    #
    # Sadece normal boşlukları kontrol ediyoruz.
    # Satır/paragraf sonlarını kontrol etmiyoruz.
    # --------------------------------------------------------

    pattern = r"[ \t]+([,!?;:])"

    for match in re.finditer(
        pattern,
        working_text
    ):

        punctuation = match.group(1)

        errors.append({
            "type": "noktalama öncesi boşluk",
            "original": match.group(0),
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
    # URL'ler zaten korundu.
    # --------------------------------------------------------

    pattern = r"([.!?,;:])([A-Za-zÇĞİÖŞÜçğıöşü])"

    for match in re.finditer(
        pattern,
        working_text
    ):

        punctuation = match.group(1)

        letter = match.group(2)

        # Büyük harfle başlayan kısaltmalar:
        #
        # Ö.M.
        # Ö.S.
        # A.B.
        # A.Ş.
        #
        # Bunları hata kabul etmiyoruz.

        if punctuation == "." and letter.isupper():

            before = working_text[
                max(
                    0,
                    match.start() - 2
                ):
                match.start()
            ]

            if re.search(
                r"[A-ZÇĞİÖŞÜ]\.",
                before
            ):
                continue

            # Tek harfli büyük harfli kısaltmalar
            continue

        errors.append({
            "type": "noktalama sonrası eksik boşluk",
            "original": match.group(0),
            "suggestion": (
                punctuation +
                " " +
                letter
            ),
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

    pattern = (
        r"([A-Za-zÇĞİÖŞÜçğıöşü])(\d+)"
    )

    for match in re.finditer(
        pattern,
        working_text
    ):

        letter = match.group(1)

        number = match.group(2)

        # 4 haneli yılları otomatik hata kabul etmiyoruz.

        if len(number) == 4:
            continue

        errors.append({
            "type": "kelime-sayı birleşmesi",
            "original": match.group(0),
            "suggestion": (
                letter +
                " " +
                number
            ),
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

    pattern = (
        r"(\d)([A-Za-zÇĞİÖŞÜçğıöşü])"
    )

    for match in re.finditer(
        pattern,
        working_text
    ):

        # Saat kontrolü

        before = working_text[
            max(
                0,
                match.start() - 3
            ):
            match.start() + 3
        ]

        if ":" in before:
            continue

        errors.append({
            "type": "sayı-kelime birleşmesi",
            "original": match.group(0),
            "suggestion": (
                match.group(1) +
                " " +
                match.group(2)
            ),
            "context": get_context(
                working_text,
                match.start(),
                match.end()
            )
        })

    # --------------------------------------------------------
    # 5. YURT DIŞI
    # --------------------------------------------------------

    patterns = [
        (
            r"\byurtdışına\b",
            "yurt dışına"
        ),
        (
            r"\byurtdışında\b",
            "yurt dışında"
        ),
        (
            r"\byurtdışından\b",
            "yurt dışından"
        ),
        (
            r"\byurtdışı\b",
            "yurt dışı"
        )
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
    # URL'LERİ GERİ KOY
    # --------------------------------------------------------

    for index, original in enumerate(
        protected
    ):

        working_text = working_text.replace(
            f"___WEBPROOF_URL_{index}___",
            original
        )

    return remove_duplicate_errors(
        errors
    )


# ============================================================
# BBC HABER LİNKLERİ
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

        if not parsed.path.startswith(
            "/turkce/articles/"
        ):
            continue

        clean_url = (
            "https://www.bbc.com" +
            parsed.path
        )

        if clean_url not in urls:

            urls.append(
                clean_url
            )

    return urls


# ============================================================
# HABER METNİ
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

    main = soup.find(
        "main"
    )

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

    for p in main.find_all(
        "p"
    ):

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
# NVIDIA PROMPT
# ============================================================

def build_prompt(article):

    return f"""
Sen profesyonel bir Türkçe haber editörüsün.

Aşağıdaki haber metnini yalnızca KESİN hatalar açısından kontrol et.

SADECE ŞUNLARI BUL:

- Kesin yazım hataları
- Kesin dilbilgisi hataları
- Kesin noktalama hataları
- Açık harf veya klavye hataları
- Açık boşluk hataları

KESİNLİK KURALI:

Emin değilsen HATA BİLDİRME.

Stil tercihini hata olarak değerlendirme.

Cümleyi daha güzel hale getirme.

Gazetecilik üslubunu değiştirme.

Anlamı değiştirme.

Kişi isimlerini değiştirme.

Kurum isimlerini değiştirme.

Yer isimlerini değiştirme.

Özel isimleri değiştirme.

Siyasi ifadeleri değiştirme.

Bir kelimenin doğru olup olmadığından emin değilsen
onu hata olarak bildirme.

ÇIKTI KURALI:

Kesin hata yoksa SADECE:

HATA YOK

Kesin hata varsa yalnızca şu formatı kullan:

HATA
Orijinal: [hatalı bölüm]
Öneri: [doğru biçim]
Açıklama: [çok kısa açıklama]

Birden fazla hata varsa aynı formatı tekrar et.

ÇOK ÖNEMLİ:

Markdown kullanma.

JSON kullanma.

İngilizce kullanma.

Düşünme sürecini yazma.

Reasoning yazma.

Thinking process yazma.

Ara değerlendirme yazma.

Sadece nihai sonucu ver.

HABER BAŞLIĞI:
{article["title"]}

HABER METNİ:
{article["text"]}
"""


# ============================================================
# NVIDIA ÇIKTISINI TEMİZLE
# ============================================================

def clean_nvidia_output(output):

    if not output:
        return None

    text = output.strip()

    # --------------------------------------------------------
    # Model bazen </think> bırakabiliyor.
    # --------------------------------------------------------

    if "</think>" in text:

        text = text.split(
            "</think>",
            1
        )[1].strip()

    # --------------------------------------------------------
    # Boş / anlamsız çıktı
    # --------------------------------------------------------

    if len(text) < 3:
        return None

    # --------------------------------------------------------
    # Beklenen temiz sonuç
    # --------------------------------------------------------

    if text.upper() == "HATA YOK":

        return "HATA YOK"

    # --------------------------------------------------------
    # HATA formatı var mı?
    # --------------------------------------------------------

    if "HATA" in text and (
        "Orijinal:" in text or
        "Öneri:" in text
    ):

        return text

    # --------------------------------------------------------
    # NVIDIA bazen açıklama ekleyebilir.
    # Eğer açıkça HATA YOK diyorsa onu al.
    # --------------------------------------------------------

    if re.search(
        r"\bHATA\s+YOK\b",
        text,
        flags=re.IGNORECASE
    ):

        return "HATA YOK"

    # --------------------------------------------------------
    # Beklenmeyen / bozuk çıktı
    # --------------------------------------------------------

    return None


# ============================================================
# NVIDIA ANALİZİ
# ============================================================

def analyze_with_nvidia(article):

    prompt = build_prompt(
        article
    )

    for attempt in range(1, 3):

        try:

            response = client.chat.completions.create(

                model=MODEL,

                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Profesyonel Türkçe haber "
                            "editörü olarak çalış. "
                            "Sadece nihai sonucu ver. "
                            "İç düşünme veya reasoning "
                            "gösterme."
                        )
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],

                temperature=0.0,

                top_p=0.9,

                max_tokens=1500,

                stream=False,

                extra_body={
                    "chat_template_kwargs": {
                        "enable_thinking": False
                    }
                }
            )

            raw = response.choices[
                0
            ].message.content

            cleaned = clean_nvidia_output(
                raw
            )

            if cleaned:

                return cleaned

            print(
                "⚠️ NVIDIA beklenmeyen "
                "format döndürdü."
            )

            if attempt == 1:

                print(
                    "🔄 NVIDIA tekrar deneniyor..."
                )

        except Exception as e:

            error_text = str(e)

            if "429" in error_text:

                return (
                    "NVIDIA KOTA/LİMİT: "
                    "Bu haber analiz edilemedi."
                )

            if "410" in error_text:

                return (
                    "NVIDIA MODEL HATASI: "
                    "Model kullanılamıyor."
                )

            print(
                f"NVIDIA hata "
                f"(deneme {attempt}): "
                f"{error_text}"
            )

            if attempt == 2:

                return (
                    "NVIDIA ANALİZİ "
                    "TAMAMLANAMADI."
                )

    return (
        "NVIDIA ANALİZİ "
        "TAMAMLANAMADI."
    )


# ============================================================
# ANA PROGRAM
# ============================================================

print()
print("========================================")
print("WEBPROOF AI")
print("KURAL MOTORU + NVIDIA")
print("ÇIKTI KONTROLLÜ SÜRÜM")
print("========================================")
print()

try:

    urls = get_article_urls()

    print(
        f"Bulunan haber bağlantısı: "
        f"{len(urls)}"
    )

    urls = urls[:MAX_ARTICLES]

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
            print("❌ HABER HATASI")

            print(
                "----------------------------------------"
            )

            print(error_text)

    # --------------------------------------------------------
    # GENEL SONUÇ
    # --------------------------------------------------------

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
