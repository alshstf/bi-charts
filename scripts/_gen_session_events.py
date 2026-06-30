#!/usr/bin/env python3
"""Генератор синтетических событий сессий регистрации GigaID -> SQL для Postgres.
Печатает DROP/CREATE TABLE session_events + INSERT'ы. Сессии «грязные»:
ветвление sms/email/sber_id, возвраты назад, повторы, ошибки, паузы."""
import random
from datetime import datetime, timedelta

random.seed(7)

TRUNK = ["Открыл форму", "Ввёл контакт", "Дошёл до выбора способа"]
BRANCH = {
    "sms": ["Запросил код", "Ввёл код"],
    "email": ["Письмо отправлено", "Перешёл по ссылке"],
    "sber_id": ["Редирект в СберID", "Авторизовался"],
}
SUCCESS = "Успешная регистрация"
SCREEN = {
    "Открыл форму": "/reg/start", "Ввёл контакт": "/reg/contact",
    "Дошёл до выбора способа": "/reg/method", "Запросил код": "/reg/otp",
    "Ввёл код": "/reg/otp", "Письмо отправлено": "/reg/email",
    "Перешёл по ссылке": "/reg/email", "Редирект в СберID": "/reg/sberid",
    "Авторизовался": "/reg/sberid", "Успешная регистрация": "/reg/done",
}
ERRORS = {
    "Ввёл код": ("OTP_EXPIRED", "Код истёк (TTL 60с)"),
    "Перешёл по ссылке": ("LINK_EXPIRED", "Ссылка устарела"),
    "Авторизовался": ("SBER_DENIED", "СберID отклонил вход"),
}
PARTNERS = ["Ozon", "Wildberries", "Avito", "2GIS", "Litres", "Okko"]
DEVICES = ["iOS 17.4", "Android 14", "Web Chrome", "Web Safari"]

rows = []


def emit(sid, base, off, user, partner, device, step, branch, status,
         err=None, msg=None, lat=None):
    ts = base + timedelta(seconds=off)
    rows.append((sid, ts, user, partner, device, step, branch, status, err, msg,
                 lat if lat is not None else random.randint(60, 400),
                 SCREEN.get(step, "")))


def gen(sid, base, user, partner, device, scenario):
    off = 0
    for s in TRUNK:
        emit(sid, base, off, user, partner, device, s, "", "ok")
        off += random.randint(3, 12)
    tried = []

    def attempt(br, fail_entry=False, fail_step2=False):
        nonlocal off
        s0, s1 = BRANCH[br]
        emit(sid, base, off, user, partner, device, s0, br, "ok")
        off += random.randint(4, 10)
        if fail_entry:  # не пришёл код / письмо
            emit(sid, base, off, user, partner, device, s0, br, "warn",
                 None, "канал не доставил", random.randint(200, 900))
            off += random.randint(20, 50)
            return False
        if fail_step2:
            err, msg = ERRORS[s1]
            emit(sid, base, off + random.randint(30, 60), user, partner, device,
                 s1, br, "error", err, msg, random.randint(300, 1200))
            off += random.randint(35, 70)
            return False
        emit(sid, base, off, user, partner, device, s1, br, "ok")
        off += random.randint(3, 8)
        return True

    def back():
        nonlocal off
        emit(sid, base, off, user, partner, device, "Дошёл до выбора способа",
             "", "nav")
        off += random.randint(2, 6)

    if scenario == "success":
        attempt(random.choice(list(BRANCH)))
        emit(sid, base, off, user, partner, device, SUCCESS, "", "ok")
    elif scenario == "fail_simple":
        attempt(random.choice(list(BRANCH)), fail_step2=True)
    elif scenario == "switch_fail":
        b1, b2 = random.sample(list(BRANCH), 2)
        attempt(b1, fail_entry=True)
        back()
        attempt(b2, fail_step2=True)
    elif scenario == "switch_success":
        b1, b2 = random.sample(list(BRANCH), 2)
        attempt(b1, fail_entry=True)
        back()
        if attempt(b2):
            emit(sid, base, off, user, partner, device, SUCCESS, "", "ok")


def showcase():
    sid = "9f3a2b00-0000-0000-0000-0000000000c21"
    base = datetime(2026, 6, 30, 14, 32, 1)
    u, p, d = 48213, "Okko", "iOS 17.4"
    emit(sid, base, 0, u, p, d, "Открыл форму", "", "ok", lat=120)
    emit(sid, base, 8, u, p, d, "Ввёл контакт", "", "ok", lat=240)
    emit(sid, base, 20, u, p, d, "Дошёл до выбора способа", "", "ok", lat=90)
    emit(sid, base, 23, u, p, d, "Запросил код", "sms", "ok", lat=140)
    emit(sid, base, 59, u, p, d, "Запросил код", "sms", "warn", None,
         "SMS не доставлен (60с)", 700)
    emit(sid, base, 64, u, p, d, "Дошёл до выбора способа", "", "nav")
    emit(sid, base, 67, u, p, d, "Редирект в СберID", "sber_id", "ok", lat=300)
    emit(sid, base, 79, u, p, d, "Дошёл до выбора способа", "", "nav")
    emit(sid, base, 84, u, p, d, "Запросил код", "sms", "ok", lat=150)
    emit(sid, base, 91, u, p, d, "Ввёл код", "sms", "error", "OTP_EXPIRED",
         "Код истёк: TTL 60с, введён на 67с", 820)


showcase()
now = datetime(2026, 6, 30, 12, 0, 0)
scenarios = (["success"] * 22 + ["fail_simple"] * 14 + ["switch_fail"] * 14 +
             ["switch_success"] * 10)
for i in range(60):
    sid = f"sess-{i:04d}-{random.randint(1000,9999)}"
    base = now - timedelta(days=random.randint(0, 13), minutes=random.randint(0, 1440))
    gen(sid, base, 10000 + i, random.choice(PARTNERS), random.choice(DEVICES),
        random.choice(scenarios))

# --- SQL ---
print("DROP TABLE IF EXISTS session_events;")
print("""CREATE TABLE session_events (
  session_id text NOT NULL, event_time timestamp NOT NULL, user_id int,
  partner_source text, device text, step_name text NOT NULL, branch text,
  status text, error_code text, error_msg text, latency_ms int, screen text);""")


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, datetime):
        return "'" + v.strftime("%Y-%m-%d %H:%M:%S") + "'"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


for batch_start in range(0, len(rows), 100):
    chunk = rows[batch_start:batch_start + 100]
    print("INSERT INTO session_events (session_id,event_time,user_id,partner_source,"
          "device,step_name,branch,status,error_code,error_msg,latency_ms,screen) VALUES")
    print(",\n".join("(" + ",".join(lit(x) for x in r) + ")" for r in chunk) + ";")
