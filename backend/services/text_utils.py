import unicodedata


def normalize_text(text: str) -> str:
    value = text.strip().lower()
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = " ".join(value.split())
    return value


def slugify(text: str) -> str:
    return normalize_text(text).replace(" ", "-")


def make_incipit(text: str, max_words: int = 6) -> str:
    words = text.strip().split()
    return " ".join(words[:max_words])
