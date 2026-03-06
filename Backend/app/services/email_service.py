"""
email_service.py
Simple email service for study-plan reminders.

For the hackathon demo, this logs reminders to the console.
To enable real emails, set EMAIL_SENDER, EMAIL_PASSWORD, and
optionally SMTP_HOST / SMTP_PORT in .env. Uses SMTP (Gmail-compatible).
"""

import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
EMAIL_SENDER = os.getenv("EMAIL_SENDER", "")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "")


def _build_html(goal_title: str, progress: int, tasks: list[str]) -> str:
    """Build a simple HTML email body for a reminder."""
    tasks_html = "".join(f"<li>{t}</li>" for t in tasks)
    return f"""
    <html>
    <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>📚 StudyBuddy Reminder</h2>
        <p>Time to work on your goal: <strong>{goal_title}</strong></p>
        <p>Current progress: <strong>{progress}%</strong></p>
        {"<h3>This week's tasks:</h3><ul>" + tasks_html + "</ul>" if tasks else ""}
        <hr>
        <p style="color: #888; font-size: 12px;">
            This is an automated reminder from StudyBuddy.
        </p>
    </body>
    </html>
    """


def send_reminder_email(
    to_email: str,
    goal_title: str,
    progress: int = 0,
    tasks: list[str] | None = None,
) -> bool:
    """
    Send a reminder email for a study goal.

    Returns True if the email was sent (or logged in demo mode).
    """
    tasks = tasks or []
    html = _build_html(goal_title, progress, tasks)

    # ── Demo mode: log to console ─────────────────────────────────────────────
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print(f"[EmailService] (demo) Reminder for '{goal_title}' -> {to_email}")
        print(f"  Progress: {progress}%, Tasks: {tasks}")
        return True

    # ── Real send via SMTP ────────────────────────────────────────────────────
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"StudyBuddy Reminder: {goal_title}"
        msg["From"] = EMAIL_SENDER
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.sendmail(EMAIL_SENDER, to_email, msg.as_string())

        print(f"[EmailService] Sent reminder for '{goal_title}' -> {to_email}")
        return True
    except Exception as e:
        print(f"[EmailService] Failed to send email: {e}")
        return False
