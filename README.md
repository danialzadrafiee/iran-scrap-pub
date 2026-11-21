# راهنمای نصب و اجرا روی سرور

این راهنما برای نصب سریع برنامه روی سرور لینوکس (Ubuntu / Debian) با Docker است.

## پیش‌نیاز
روی سرور باید **Git** و **Docker** نصب باشد. اگر نصب نیستند، این دستور را بزنید:

```bash
sudo apt update && sudo apt install -y git
curl -fsSL https://get.docker.com | sh
```

## ۱. دانلود پروژه
```bash
git clone https://github.com/danialzadrafiee/iran-scrap-pub.git
cd iran-scrap-pub
```

## ۲. اجرا با Docker
```bash
docker compose up -d --build
```
> بار اول ممکن است چند دقیقه طول بکشد تا ایمیج ساخته شود.

## ۳. باز کردن پنل
بعد از تمام شدن اجرا، این آدرس را در مرورگر باز کنید (به‌جای `SERVER-IP` آی‌پی سرور خودتان را بگذارید):

```text
http://SERVER-IP:8080
```
اگر باز نشد، مطمئن شوید پورت `8080` در فایروال سرور باز است.

---

## دستورهای پرکاربرد

**آپدیت برنامه به نسخه جدید:**
```bash
cd iran-scrap-pub
git pull
docker compose up -d --build
```

**دیدن لاگ‌های زنده:**
```bash
docker compose logs -f
```

**متوقف کردن برنامه:**
```bash
docker compose down
```
