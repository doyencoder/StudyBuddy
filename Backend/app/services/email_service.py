"""
email_service.py  —  StudyBuddy notification emails
"""

import os, smtplib
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST      = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT      = int(os.getenv("SMTP_PORT", "587"))
EMAIL_SENDER   = os.getenv("EMAIL_SENDER", "")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "")
SITE_URL       = os.getenv("SITE_URL", "https://study-buddy-five-jade.vercel.app")

_STYLE = """
  body{font-family:'Segoe UI',Arial,sans-serif;background:#0f1117;margin:0;padding:0}
  .wrap{max-width:560px;margin:40px auto;background:#1a1d27;border-radius:16px;overflow:hidden;border:1px solid #2d2f3e}
  .hero{background:linear-gradient(135deg,#6c63ff 0%,#4f46e5 100%);padding:36px 32px 28px;text-align:center}
  .hero-icon{font-size:40px;margin-bottom:12px}
  .hero h1{color:#fff;font-size:22px;font-weight:700;margin:0 0 6px}
  .hero p{color:rgba(255,255,255,.75);font-size:14px;margin:0}
  .body{padding:28px 32px}
  .body p{color:#c9cbd6;font-size:15px;line-height:1.65;margin:0 0 14px}
  .goal-block{background:#252836;border-radius:12px;padding:18px 20px;margin:20px 0;border:1px solid #2d2f3e}
  .goal-title{color:#e2e3eb;font-size:15px;font-weight:600;margin:0 0 12px}
  .highlight{background:#1e2030;border-left:3px solid #6c63ff;border-radius:0 8px 8px 0;padding:12px 16px;margin:10px 0}
  .highlight p{margin:0;color:#c9cbd6;font-size:13px}
  .task-list{list-style:none;padding:0;margin:10px 0 0}
  .task-list li{color:#c9cbd6;font-size:13px;padding:5px 0;border-bottom:1px solid #2d2f3e;display:flex;align-items:center;gap:8px}
  .task-list li:last-child{border-bottom:none}
  .done{color:#4ade80;font-size:14px}
  .pending{color:#facc15;font-size:14px}
  .cta{display:block;background:#6c63ff;color:#fff;font-weight:600;font-size:15px;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;margin:22px 0 4px}
  .footer{padding:18px 32px;background:#141620;text-align:center}
  .footer p{color:#5a5c6b;font-size:12px;margin:0}
  .progress-bar-bg{background:#2d2f3e;border-radius:8px;height:8px;margin:8px 0}
  .progress-bar-fill{background:linear-gradient(90deg,#6c63ff,#818cf8);height:8px;border-radius:8px}
  .stat-row{display:flex;gap:10px;margin:10px 0}
  .stat{flex:1;background:#1e2030;border-radius:8px;padding:10px;text-align:center}
  .stat-num{color:#a89fff;font-size:18px;font-weight:700}
  .stat-label{color:#6b6d7e;font-size:10px;margin-top:2px}
"""

def _today_label():
    """Returns e.g. 'Sun, Mar 23' — used in subjects to prevent Gmail threading."""
    return datetime.now(timezone.utc).strftime("%a, %b %-d")


def _send(to_email, subject, html, demo_label):
    from_header = f"Study Buddy <{EMAIL_SENDER}>" if EMAIL_SENDER else "Study Buddy"
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print(f"[EmailService] (demo) {demo_label} -> {to_email}")
        return True
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = from_header
        msg["To"]      = to_email
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as srv:
            srv.starttls()
            srv.login(EMAIL_SENDER, EMAIL_PASSWORD)
            srv.sendmail(EMAIL_SENDER, to_email, msg.as_string())
        print(f"[EmailService] Sent '{subject}' -> {to_email}")
        return True
    except Exception as e:
        print(f"[EmailService] Failed: {e}")
        return False


# ── 1. Daily goals reminder ───────────────────────────────────────────────────

def send_daily_goals_reminder(to_email, display_name, goals_done, goals_total):
    name    = display_name or "Student"
    pct     = int((goals_done / goals_total) * 100) if goals_total else 0
    pending = goals_total - goals_done
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_STYLE}</style></head><body>
<div class="wrap">
  <div class="hero">
    <div class="hero-icon">&#127919;</div>
    <h1>Don't forget your daily goals!</h1>
    <p>A friendly nudge from Study Buddy</p>
  </div>
  <div class="body">
    <p>Hey <strong style="color:#e2e3eb">{name}</strong>,</p>
    <p>It's 9 PM and you still have <strong style="color:#facc15">{pending} goal{'s' if pending!=1 else ''}</strong> left today.
       You've done {goals_done} of {goals_total} — keep going!</p>
    <div class="goal-block">
      <p class="goal-title">Today's progress</p>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:{pct}%"></div></div>
      <p style="color:#a89fff;font-size:13px;margin:6px 0 0">{goals_done}/{goals_total} tasks ({pct}%)</p>
    </div>
    <p>Small steps every day lead to big results. You've got this! &#128170;</p>
    <a href="{SITE_URL}/goals" class="cta">Complete my goals &#8594;</a>
  </div>
  <div class="footer"><p>Study Buddy &middot; Goal reminders are on in Settings.</p></div>
</div></body></html>"""
    # Date in subject prevents Gmail from threading separate days together
    subject = f"\u23f0 Daily goals reminder \u2014 {_today_label()}"
    return _send(to_email, subject, html, f"Daily goals reminder ({goals_done}/{goals_total})")


# ── 2. Weekly all-goals summary (ONE email, all goals inside) ─────────────────

def _render_goal_block(goal_title, weeks_elapsed, weeks_total, weeks_remaining,
                        tasks_done, tasks_pending, overall_progress):
    """Renders a single goal card to embed inside the digest email."""
    done_html    = "".join(f'<li><span class="done">&#10003;</span> {t}</li>' for t in tasks_done)
    pending_html = "".join(f'<li><span class="pending">&#9675;</span> {t}</li>' for t in tasks_pending)
    weeks_pct    = int((weeks_elapsed / weeks_total) * 100) if weeks_total else 0
    tasks_section = ""
    if done_html:
        tasks_section += f'<p style="color:#c9cbd6;font-size:13px;margin:10px 0 4px"><strong>Completed this week:</strong></p><ul class="task-list">{done_html}</ul>'
    if pending_html:
        tasks_section += f'<p style="color:#c9cbd6;font-size:13px;margin:10px 0 4px"><strong>Still to do:</strong></p><ul class="task-list">{pending_html}</ul>'
    return f"""
<div class="goal-block">
  <p class="goal-title">{goal_title}</p>
  <div class="stat-row">
    <div class="stat"><div class="stat-num">{weeks_elapsed}</div><div class="stat-label">Weeks done</div></div>
    <div class="stat"><div class="stat-num">{weeks_remaining}</div><div class="stat-label">Weeks left</div></div>
    <div class="stat"><div class="stat-num">{overall_progress}%</div><div class="stat-label">Progress</div></div>
  </div>
  <div class="highlight">
    <p>Timeline ({weeks_elapsed}/{weeks_total} weeks)</p>
    <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:{weeks_pct}%"></div></div>
  </div>
  {tasks_section}
</div>"""


def send_weekly_all_goals_summary(to_email, display_name, goals_data: list):
    """
    Sends ONE email summarising ALL active long-term goals.

    goals_data: list of dicts with keys:
      goal_title, weeks_elapsed, weeks_total, weeks_remaining,
      tasks_done_this_week, tasks_pending_this_week, overall_progress
    """
    name = display_name or "Student"
    goal_count = len(goals_data)
    all_blocks = "".join(
        _render_goal_block(
            g["goal_title"], g["weeks_elapsed"], g["weeks_total"], g["weeks_remaining"],
            g["tasks_done_this_week"], g["tasks_pending_this_week"], g["overall_progress"],
        )
        for g in goals_data
    )
    plural = "goal" if goal_count == 1 else "goals"
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_STYLE}</style></head><body>
<div class="wrap">
  <div class="hero">
    <div class="hero-icon">&#128197;</div>
    <h1>Your weekly progress</h1>
    <p>{goal_count} active {plural} &mdash; {_today_label()}</p>
  </div>
  <div class="body">
    <p>Hey <strong style="color:#e2e3eb">{name}</strong>,</p>
    <p>Here's how your long-term goals are looking this week. Keep the momentum going!</p>
    {all_blocks}
    <a href="{SITE_URL}/goals" class="cta">View all my goals &#8594;</a>
  </div>
  <div class="footer"><p>Study Buddy &middot; Long-term goal reminders are on in Settings.</p></div>
</div></body></html>"""
    # Date in subject prevents Gmail threading across different weeks
    subject = f"\U0001f4c5 Weekly goals update \u2014 {_today_label()}"
    return _send(to_email, subject, html, f"Weekly digest ({goal_count} goals)")


# ── 3. Study streak alert ─────────────────────────────────────────────────────

def send_streak_alert(to_email, display_name):
    name = display_name or "Student"
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_STYLE}</style></head><body>
<div class="wrap">
  <div class="hero">
    <div class="hero-icon">&#128293;</div>
    <h1>Don't break your streak!</h1>
    <p>Your study habit is worth protecting</p>
  </div>
  <div class="body">
    <p>Hey <strong style="color:#e2e3eb">{name}</strong>,</p>
    <p>You haven't visited Study Buddy today. Even 10 minutes of studying keeps your streak alive!</p>
    <div class="goal-block">
      <p class="goal-title" style="margin:0 0 8px">&#9889; Quick ideas for tonight</p>
      <ul style="margin:0;padding-left:18px;color:#c9cbd6;font-size:14px;line-height:1.8">
        <li>Review your last chat conversation</li>
        <li>Take a quick 5-question quiz</li>
        <li>Add one new daily goal for tomorrow</li>
      </ul>
    </div>
    <p>Consistency is the secret to mastery. Log in before midnight!</p>
    <a href="{SITE_URL}/chat" class="cta">Study now &#8594;</a>
  </div>
  <div class="footer"><p>Study Buddy &middot; Streak alerts are on in Settings.</p></div>
</div></body></html>"""
    # Date in subject prevents threading separate days' alerts together
    subject = f"\U0001f525 Study streak alert \u2014 {_today_label()}"
    return _send(to_email, subject, html, "Streak alert")


# ── 4. Flashcard review reminder ─────────────────────────────────────────────

def send_flashcard_review_reminder(to_email, display_name):
    name = display_name or "Student"
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_STYLE}</style></head><body>
<div class="wrap">
  <div class="hero">
    <div class="hero-icon">&#128209;</div>
    <h1>Time to revise your flashcards</h1>
    <p>Your 12 PM Study Buddy reminder</p>
  </div>
  <div class="body">
    <p>Hey <strong style="color:#e2e3eb">{name}</strong>,</p>
    <p>It's noon — this is a great time to do a quick flashcard review and keep the material fresh in your mind.</p>
    <div class="goal-block">
      <p class="goal-title" style="margin:0 0 8px">&#9889; Quick revision plan</p>
      <ul style="margin:0;padding-left:18px;color:#c9cbd6;font-size:14px;line-height:1.8">
        <li>Open one flashcard deck</li>
        <li>Review difficult terms first</li>
        <li>Spend 5 to 10 focused minutes revising</li>
      </ul>
    </div>
    <p>Short daily revision sessions make recall much stronger over time.</p>
    <a href="{SITE_URL}/flashcards" class="cta">Review flashcards &#8594;</a>
  </div>
  <div class="footer"><p>Study Buddy &middot; Flashcard review reminders are on in Settings.</p></div>
</div></body></html>"""
    subject = f"\U0001f4dd Flashcard review reminder \u2014 {_today_label()}"
    return _send(to_email, subject, html, "Flashcard review reminder")


# ── Legacy per-goal function (kept for backward compat — do not use in new code) ──

def send_weekly_longterm_reminder(to_email, display_name, goal_title, weeks_elapsed,
                                   weeks_total, weeks_remaining, tasks_done_this_week,
                                   tasks_pending_this_week, overall_progress):
    """Wraps the new digest function for a single goal."""
    return send_weekly_all_goals_summary(
        to_email=to_email,
        display_name=display_name,
        goals_data=[{
            "goal_title": goal_title,
            "weeks_elapsed": weeks_elapsed,
            "weeks_total": weeks_total,
            "weeks_remaining": weeks_remaining,
            "tasks_done_this_week": tasks_done_this_week,
            "tasks_pending_this_week": tasks_pending_this_week,
            "overall_progress": overall_progress,
        }],
    )


def send_reminder_email(to_email, goal_title, progress=0, tasks=None):
    return send_weekly_longterm_reminder(
        to_email=to_email, display_name="", goal_title=goal_title,
        weeks_elapsed=1, weeks_total=4, weeks_remaining=3,
        tasks_done_this_week=[], tasks_pending_this_week=tasks or [],
        overall_progress=progress,
    )
