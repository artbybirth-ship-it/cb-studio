"""Tolerant FLA (ZIP) reader: walks the local file headers instead of trusting the central directory."""
import struct, zlib, sys


def read_entries(path):
    data = open(path, "rb").read()
    out, pos, problems = {}, 0, []
    while True:
        i = data.find(b"PK\x03\x04", pos)
        if i < 0:
            break
        (ver, flag, method, _t, _d, crc, csize, usize, nlen, xlen) = struct.unpack("<HHHHHIIIHH", data[i + 4:i + 30])
        name = data[i + 30:i + 30 + nlen].decode("utf-8", "replace")
        start = i + 30 + nlen + xlen
        body = None
        try:
            if method == 0:
                if flag & 8 and csize == 0:
                    raise ValueError("stored entry with data descriptor")
                body = data[start:start + csize]
                end = start + csize
            elif method == 8:
                d = zlib.decompressobj(-15)
                chunk = data[start:start + csize] if csize and not (flag & 8) else data[start:]
                body = d.decompress(chunk)
                used = len(chunk) - len(d.unused_data)
                end = start + used
            else:
                raise ValueError(f"method {method}")
            if usize and not (flag & 8) and len(body) != usize:
                problems.append(f"{name}: size {len(body)} != {usize}")
        except Exception as e:  # keep going: one bad entry must not stop the import
            problems.append(f"{name}: {e}")
            end = start + max(csize, 1)
        if body is not None and not name.endswith("/"):
            out[name] = body
        pos = max(end, i + 4)
    return out, problems


if __name__ == "__main__":
    entries, problems = read_entries(sys.argv[1])
    print(len(entries), "entries;", len(problems), "problems")
    for p in problems[:10]:
        print(" !", p)
