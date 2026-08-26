import base64
import json
import os
import sqlite3

db_path = os.path.join(os.environ['APPDATA'], 'trae-account-manager', 'data.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    'SELECT id, nickname, user_id, refresh_token, token_expired_at, source, is_active, deleted_at FROM accounts'
).fetchall()

def jwt_payload(token):
    if not isinstance(token, str):
        return None
    parts = token.split('.')
    if len(parts) != 3:
        return None
    try:
        pad = parts[1] + '=' * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(pad))
    except Exception:
        return None

print(f'DB: {db_path}')
print(f'rows: {len(rows)}')
print()
for r in rows:
    rt = r['refresh_token']
    p = jwt_payload(rt) if rt else None
    rt_identity = None
    rt_exp = None
    if p:
        rt_identity = p.get('data', {}).get('id') if isinstance(p.get('data'), dict) else p.get('user_id', p.get('sub'))
        rt_exp = p.get('exp')
    fmt = lambda s: (s[:8] + f'..({len(s)})') if isinstance(s, str) and len(s) > 8 else s
    print(
        f"id={r['id']} user={r['user_id']} src={r['source']} active={r['is_active']} "
        f"deleted={'Y' if r['deleted_at'] else 'n'} {r['nickname']} | "
        f"RT={fmt(rt) if rt else '(none)'} RTisJWT={'yes' if p else 'no'} "
        f"RTidentity={rt_identity if rt_identity is not None else '-'} RTexp={rt_exp or '-'} "
        f"tokenExp={r['token_expired_at'] or '-'}"
    )
