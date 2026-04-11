from __future__ import annotations

"""Persistenza delle impostazioni utente in settings.json (root del progetto)."""
import json
import pathlib

_PATH = pathlib.Path(__file__).parent.parent / 'settings.json'


def load() -> dict:
    if _PATH.exists():
        try:
            return json.loads(_PATH.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}


def save(data: dict) -> None:
    existing = load()
    existing.update(data)
    _PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding='utf-8')


def get_group() -> tuple[int | None, str]:
    """Restituisce (group_id, group_name) dalle impostazioni salvate."""
    data = load()
    gid = data.get('group_id')
    name = data.get('group_name', '')
    return gid, name


def set_group(group_id: int, group_name: str) -> None:
    save({'group_id': group_id, 'group_name': group_name})


def get_signal_examples() -> list[dict]:
    """Restituisce i messaggi salvati come esempi di segnale."""
    return load().get('signal_examples', [])


def set_signal_examples(examples: list[dict]) -> None:
    """Sovrascrive la lista di esempi di segnale salvati."""
    save({'signal_examples': examples})
