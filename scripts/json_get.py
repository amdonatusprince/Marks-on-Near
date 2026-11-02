#!/usr/bin/env python3
"""Print one field from JSON embedded in a near-cli transcript."""

import json
import sys


_MISSING = object()


def return_value(text: str) -> object:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        lowered = line.lower()
        if "return value" not in lowered or "printed" not in lowered:
            continue
        for nxt in lines[index + 1 :]:
            stripped = nxt.strip()
            if not stripped:
                continue
            if stripped == "null":
                return None
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                if stripped.lstrip("-").isdigit():
                    return int(stripped)
                return _MISSING
    return _MISSING


def main() -> None:
    text = sys.stdin.read()
    found = []
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char not in "{[":
            continue
        try:
            decoded, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        found.append(decoded)
    returned = return_value(text)
    if returned is not _MISSING:
        found.append(returned)
    if not found:
        print("no json in command output", file=sys.stderr)
        print(text, file=sys.stderr)
        sys.exit(1)

    def emit(current: object) -> None:
        if current is None:
            print("null")
        elif isinstance(current, (dict, list)):
            print(json.dumps(current))
        else:
            print(current)

    def walk(current: object, field: str) -> object:
        for part in field.split("."):
            if isinstance(current, list):
                current = current[int(part)]
            elif isinstance(current, dict):
                current = current[part]
            else:
                raise KeyError(part)
        return current

    field = sys.argv[1]
    if field == "@":
        emit(found[-1])
        return
    for candidate in reversed(found):
        try:
            emit(walk(candidate, field))
            return
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    print(f"field {field} was not in the command output", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
