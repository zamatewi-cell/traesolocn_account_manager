import ctypes
import json
import os
import sqlite3

db_path = os.path.join(os.environ['APPDATA'], 'trae-account-manager', 'data.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    'SELECT id, nickname, user_id, refresh_token, source, is_active, deleted_at, auth_blob_encrypted FROM accounts'
).fetchall()


class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', ctypes.c_ulong), ('pbData', ctypes.POINTER(ctypes.c_char))]


def dpapi_decrypt(data: bytes):
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    ):
        return None
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


print(f'DB: {db_path}')
for r in rows:
    rt = r['refresh_token']
    fmt = lambda s: (s[:8] + f'..({len(s)})') if isinstance(s, str) and len(s) > 8 else s
    line = f"id={r['id']} user={r['user_id']} src={r['source']} active={r['is_active']} del={'Y' if r['deleted_at'] else 'n'} colRT={fmt(rt) if rt else '(none)'}"
    enc = r['auth_blob_encrypted']
    if not enc:
        print(line + ' | blob=(none)')
        continue
    dec = dpapi_decrypt(bytes(enc))
    if dec is None:
        print(line + f' | blob=DPAPI-FAIL(len={len(enc)})')
        continue
    try:
        blob = json.loads(dec.decode('utf-8'))
        brt = blob.get('refreshToken')
        print(
            line
            + f" | blob.userId={blob.get('userId')} blobRT={fmt(brt) if brt else '(none)'} "
            + f"blobRT==colRT: {brt == rt} blob.tokenExp={blob.get('expiredAt', '-')}"
        )
    except Exception as e:
        print(line + f' | blob=JSON-FAIL({e})')
