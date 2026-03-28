"""
Service: Coins
Stores shared gamification state in Cosmos DB.
"""

import copy
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional, Tuple

from azure.cosmos import PartitionKey
from azure.cosmos.aio import CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from dotenv import load_dotenv

load_dotenv()

DB_NAME = os.getenv("AZURE_COSMOS_DB_NAME", "studybuddy")
COINS_CONTAINER = "coins"
MAX_TRANSACTIONS = 200
MAX_WRITE_RETRIES = 5


REWARDS = {
    "DAILY_LOGIN": 2,
    "STREAK_30": 30,
    "STREAK_90": 75,
    "STREAK_365": 200,
    "QUIZ_COMPLETE": 3,
    "DOCUMENT_UPLOAD": 2,
    "REFERRAL_SENDER": 15,
    "REFERRAL_RECEIVER": 10,
}

CLIENT_COMPLETEABLE_MISSIONS = {
    "complete_quiz": {
        "name": "Complete a Quiz",
        "reward": REWARDS["QUIZ_COMPLETE"],
        "repeatable": True,
    },
    "upload_doc": {
        "name": "Upload a Document",
        "reward": REWARDS["DOCUMENT_UPLOAD"],
        "repeatable": True,
    },
}

STREAK_MILESTONES = {
    30: ("streak_30", "30-Day Streak", REWARDS["STREAK_30"]),
    90: ("streak_90", "90-Day Streak", REWARDS["STREAK_90"]),
    365: ("streak_365", "365-Day Streak", REWARDS["STREAK_365"]),
}


class _CosmosWrapper:
    __slots__ = ("_client",)
    def __init__(self, client: CosmosClient):
        self._client = client
    async def __aenter__(self) -> CosmosClient:
        return self._client
    async def __aexit__(self, *args):
        pass

_COSMOS_CLIENT: CosmosClient | None = None

def _get_client() -> _CosmosWrapper:
    global _COSMOS_CLIENT
    if _COSMOS_CLIENT is None:
        connection_string = os.getenv("AZURE_COSMOS_CONNECTION_STRING")
        if not connection_string:
            raise ValueError("AZURE_COSMOS_CONNECTION_STRING is not set in .env")
        _COSMOS_CLIENT = CosmosClient.from_connection_string(connection_string)
        print("[coins_service] Singleton CosmosClient created")
    return _CosmosWrapper(_COSMOS_CLIENT)


def _status_code(exc: Exception) -> Optional[int]:
    return getattr(exc, "status_code", None)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_ist() -> str:
    now_ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    return now_ist.strftime("%Y-%m-%d")


def _yesterday_ist() -> str:
    now_ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30) - timedelta(days=1)
    return now_ist.strftime("%Y-%m-%d")


def _generate_referral_code() -> str:
    charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "SB-" + "".join(random.choice(charset) for _ in range(6))


def _new_transaction(
    amount: int,
    reason: str,
    category: str,
    type_: str = "earn",
) -> Dict[str, Any]:
    import uuid

    return {
        "id": str(uuid.uuid4()),
        "type": type_,
        "amount": int(amount),
        "reason": reason,
        "category": category,
        "timestamp": _utc_now_iso(),
    }


def _default_coin_doc(user_id: str) -> Dict[str, Any]:
    return {
        "id": user_id,
        "user_id": user_id,
        "balance": 0,
        "lifetime_earned": 0,
        "login_streak": 0,
        "longest_streak": 0,
        "last_login_date": None,
        "last_reward_date": None,
        "transactions": [],
        "orders": [],
        "missions": {},
        "referral_code": _generate_referral_code(),
        "referred_by": None,
        "referral_count": 0,
        "referral_rewarded_users": [],
        "updated_at": None,
    }


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _sanitize_missions(raw: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(raw, dict):
        return {}

    sanitized: Dict[str, Dict[str, Any]] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        sanitized[key] = {
            "mission_id": str(value.get("mission_id") or key),
            "completed": bool(value.get("completed", False)),
            "completed_at": value.get("completed_at"),
        }
    return sanitized


def _sanitize_transactions(raw: Any) -> list[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    sanitized = []
    for entry in raw[:MAX_TRANSACTIONS]:
        if not isinstance(entry, dict):
            continue
        tx_id = str(entry.get("id") or "")
        if not tx_id:
            continue
        tx_type = "spend" if entry.get("type") == "spend" else "earn"
        sanitized.append(
            {
                "id": tx_id,
                "type": tx_type,
                "amount": _coerce_int(entry.get("amount"), 0),
                "reason": str(entry.get("reason") or ""),
                "category": str(entry.get("category") or ""),
                "timestamp": str(entry.get("timestamp") or _utc_now_iso()),
            }
        )
    return sanitized


def _sanitize_orders(raw: Any) -> list[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    sanitized = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        order_id = str(entry.get("id") or "")
        if not order_id:
            continue
        status = "pending" if entry.get("status") == "pending" else "delivered"
        sanitized.append(
            {
                "id": order_id,
                "item_id": str(entry.get("item_id") or ""),
                "item_name": str(entry.get("item_name") or ""),
                "cost": _coerce_int(entry.get("cost"), 0),
                "ordered_at": str(entry.get("ordered_at") or _utc_now_iso()),
                "status": status,
            }
        )
    return sanitized


def _sanitize_legacy_state(
    user_id: str,
    legacy_state: Optional[Dict[str, Any]],
    referral_code_fallback: str,
) -> Dict[str, Any]:
    if not isinstance(legacy_state, dict):
        return _default_coin_doc(user_id)

    default_doc = _default_coin_doc(user_id)
    default_doc["referral_code"] = referral_code_fallback

    default_doc["balance"] = max(0, _coerce_int(legacy_state.get("balance"), 0))
    default_doc["lifetime_earned"] = max(
        default_doc["balance"],
        _coerce_int(legacy_state.get("lifetime_earned"), 0),
    )
    default_doc["login_streak"] = max(0, _coerce_int(legacy_state.get("login_streak"), 0))
    default_doc["longest_streak"] = max(
        default_doc["login_streak"],
        _coerce_int(legacy_state.get("longest_streak"), 0),
    )
    default_doc["last_login_date"] = legacy_state.get("last_login_date")
    default_doc["last_reward_date"] = legacy_state.get("last_reward_date")
    default_doc["transactions"] = _sanitize_transactions(legacy_state.get("transactions"))
    default_doc["orders"] = _sanitize_orders(legacy_state.get("orders"))
    default_doc["missions"] = _sanitize_missions(legacy_state.get("missions"))
    default_doc["referral_code"] = str(legacy_state.get("referral_code") or referral_code_fallback)
    default_doc["referred_by"] = legacy_state.get("referred_by")
    default_doc["referral_count"] = max(0, _coerce_int(legacy_state.get("referral_count"), 0))
    default_doc["updated_at"] = _utc_now_iso()
    return default_doc


def _trim_transactions(item: Dict[str, Any]) -> None:
    transactions = item.get("transactions") or []
    item["transactions"] = transactions[:MAX_TRANSACTIONS]


def _sanitize_referral_rewarded_users(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []

    rewarded_users: list[str] = []
    for value in raw:
        rewarded_user_id = str(value or "").strip()
        if rewarded_user_id:
            rewarded_users.append(rewarded_user_id)
    return rewarded_users


def _public_coin_state(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": item.get("user_id", ""),
        "balance": _coerce_int(item.get("balance"), 0),
        "lifetime_earned": _coerce_int(item.get("lifetime_earned"), 0),
        "login_streak": _coerce_int(item.get("login_streak"), 0),
        "longest_streak": _coerce_int(item.get("longest_streak"), 0),
        "last_login_date": item.get("last_login_date"),
        "last_reward_date": item.get("last_reward_date"),
        "transactions": _sanitize_transactions(item.get("transactions")),
        "orders": _sanitize_orders(item.get("orders")),
        "missions": _sanitize_missions(item.get("missions")),
        "referral_code": str(item.get("referral_code") or ""),
        "referred_by": item.get("referred_by"),
        "referral_count": _coerce_int(item.get("referral_count"), 0),
        "updated_at": item.get("updated_at"),
    }


def _has_meaningful_coin_data(item: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(item, dict):
        return False

    return any(
        (
            _coerce_int(item.get("balance"), 0) > 0,
            _coerce_int(item.get("lifetime_earned"), 0) > 0,
            _coerce_int(item.get("login_streak"), 0) > 0,
            _coerce_int(item.get("longest_streak"), 0) > 0,
            bool(item.get("last_login_date")),
            bool(item.get("last_reward_date")),
            bool(_sanitize_transactions(item.get("transactions"))),
            bool(_sanitize_orders(item.get("orders"))),
            bool(_sanitize_missions(item.get("missions"))),
            bool(item.get("referred_by")),
            _coerce_int(item.get("referral_count"), 0) > 0,
        )
    )


async def ensure_coins_container() -> None:
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        try:
            await db.create_container_if_not_exists(
                id=COINS_CONTAINER,
                partition_key=PartitionKey(path="/user_id"),
            )
            print(f"[coins] Container '{COINS_CONTAINER}' ready.")
        except Exception as exc:
            print(f"[coins] Container check error (non-fatal): {exc}")


async def get_coin_state(user_id: str) -> Dict[str, Any]:
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(COINS_CONTAINER)
        try:
            item = await container.read_item(item=user_id, partition_key=user_id)
            return _public_coin_state(item)
        except CosmosResourceNotFoundError:
            return _public_coin_state(_default_coin_doc(user_id))


async def bootstrap_coin_state(
    user_id: str,
    legacy_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(COINS_CONTAINER)
        default_doc = _default_coin_doc(user_id)
        sanitized_legacy = _sanitize_legacy_state(
            user_id=user_id,
            legacy_state=legacy_state,
            referral_code_fallback=default_doc["referral_code"],
        ) if legacy_state else None

        try:
            existing = await container.read_item(item=user_id, partition_key=user_id)
            if sanitized_legacy and _has_meaningful_coin_data(sanitized_legacy) and not _has_meaningful_coin_data(existing):
                migrated = copy.deepcopy(existing)
                migrated.update(sanitized_legacy)
                migrated["id"] = user_id
                migrated["user_id"] = user_id
                migrated["referral_code"] = str(
                    sanitized_legacy.get("referral_code")
                    or existing.get("referral_code")
                    or default_doc["referral_code"]
                )
                migrated["updated_at"] = _utc_now_iso()
                await container.replace_item(
                    item=existing["id"],
                    body=migrated,
                )
                return _public_coin_state(migrated)

            return _public_coin_state(existing)
        except CosmosResourceNotFoundError:
            pass

        doc = sanitized_legacy or default_doc
        doc["id"] = user_id
        doc["user_id"] = user_id

        try:
            await container.create_item(body=doc)
            return _public_coin_state(doc)
        except Exception as exc:
            if _status_code(exc) != 409:
                raise
            existing = await container.read_item(item=user_id, partition_key=user_id)
            return _public_coin_state(existing)


MutationPayload = Tuple[bool, Any]
MutationFn = Callable[[Dict[str, Any]], MutationPayload]


async def _mutate_coin_state(
    user_id: str,
    mutator: MutationFn,
) -> Tuple[Dict[str, Any], Any]:
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(COINS_CONTAINER)

        for _ in range(MAX_WRITE_RETRIES):
            creating = False
            try:
                current = await container.read_item(item=user_id, partition_key=user_id)
            except CosmosResourceNotFoundError:
                current = _default_coin_doc(user_id)
                creating = True

            working = copy.deepcopy(current)
            changed, payload = mutator(working)

            if not changed:
                return _public_coin_state(current), payload

            working["updated_at"] = _utc_now_iso()
            _trim_transactions(working)

            try:
                if creating:
                    await container.create_item(body=working)
                else:
                    await container.replace_item(
                        item=current["id"],
                        body=working,
                    )
                return _public_coin_state(working), payload
            except Exception as exc:
                if _status_code(exc) in (409, 412):
                    continue
                raise

    raise RuntimeError("Could not update coin state after multiple retries.")


async def _get_coin_doc_by_referral_code(code: str) -> Optional[Dict[str, Any]]:
    normalized_code = (code or "").strip().upper()
    if not normalized_code:
        return None

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(COINS_CONTAINER)
        query = "SELECT * FROM c WHERE UPPER(c.referral_code) = @code"
        parameters = [{"name": "@code", "value": normalized_code}]

        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            return item

    return None


async def claim_daily_login(user_id: str) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    today = _today_ist()
    yesterday = _yesterday_ist()

    def mutator(item: Dict[str, Any]) -> MutationPayload:
        if item.get("last_reward_date") == today:
            return False, None

        login_streak = _coerce_int(item.get("login_streak"), 0)
        if item.get("last_login_date") == yesterday:
            new_streak = login_streak + 1
        elif item.get("last_login_date") == today:
            new_streak = login_streak
        else:
            new_streak = 1

        item["login_streak"] = new_streak
        item["longest_streak"] = max(_coerce_int(item.get("longest_streak"), 0), new_streak)
        item["last_login_date"] = today
        item["last_reward_date"] = today

        missions = item.setdefault("missions", {})
        streak_bonus = 0
        streak_milestone = None

        if new_streak in STREAK_MILESTONES:
            mission_id, milestone_name, milestone_reward = STREAK_MILESTONES[new_streak]
            if not missions.get(mission_id, {}).get("completed"):
                missions[mission_id] = {
                    "mission_id": mission_id,
                    "completed": True,
                    "completed_at": today,
                }
                streak_bonus = milestone_reward
                streak_milestone = milestone_name

        total_earned = REWARDS["DAILY_LOGIN"] + streak_bonus
        item["balance"] = _coerce_int(item.get("balance"), 0) + total_earned
        item["lifetime_earned"] = _coerce_int(item.get("lifetime_earned"), 0) + total_earned
        item.setdefault("transactions", []).insert(
            0,
            _new_transaction(
                amount=total_earned,
                reason=(
                    f"Daily login + {streak_milestone}"
                    if streak_milestone
                    else f"Daily login (Day {new_streak})"
                ),
                category="login",
            ),
        )
        missions["daily_login"] = {
            "mission_id": "daily_login",
            "completed": True,
            "completed_at": today,
        }

        return True, {
            "coins_earned": REWARDS["DAILY_LOGIN"],
            "new_streak": new_streak,
            "streak_bonus": streak_bonus,
            "streak_milestone": streak_milestone,
        }

    coin_state, reward = await _mutate_coin_state(user_id, mutator)

    # ── Keep study_streak in sync with login_streak ───────────────────────────
    # If a reward was given (first login of this IST day), ensure the sessions
    # container also has a record for today so the dashboard study_streak matches.
    if reward is not None:
        try:
            from app.services.sessions_service import record_heartbeat
            await record_heartbeat(user_id)
        except Exception as e:
            # Non-fatal — streak will catch up on next heartbeat
            print(f"[coins] Session heartbeat on daily login failed (non-fatal): {e}")

    return coin_state, reward


async def complete_mission(user_id: str, mission_id: str) -> Tuple[Dict[str, Any], int]:
    mission = CLIENT_COMPLETEABLE_MISSIONS.get(mission_id)
    if not mission:
        raise ValueError(f"Unsupported mission '{mission_id}'")

    today = _today_ist()

    def mutator(item: Dict[str, Any]) -> MutationPayload:
        missions = item.setdefault("missions", {})
        existing = missions.get(mission_id, {})

        if mission["repeatable"] and existing.get("completed_at") == today:
            return False, 0
        if not mission["repeatable"] and existing.get("completed"):
            return False, 0

        missions[mission_id] = {
            "mission_id": mission_id,
            "completed": True,
            "completed_at": today,
        }
        item["balance"] = _coerce_int(item.get("balance"), 0) + mission["reward"]
        item["lifetime_earned"] = _coerce_int(item.get("lifetime_earned"), 0) + mission["reward"]
        item.setdefault("transactions", []).insert(
            0,
            _new_transaction(
                amount=mission["reward"],
                reason=f"Mission: {mission['name']}",
                category="mission",
            ),
        )
        return True, mission["reward"]

    return await _mutate_coin_state(user_id, mutator)


async def apply_referral_code(user_id: str, code: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    normalized_code = (code or "").strip().upper()
    if not normalized_code:
        raise ValueError("Referral code is required.")

    referrer = await _get_coin_doc_by_referral_code(normalized_code)
    if not referrer:
        return await get_coin_state(user_id), {"applied": False, "reason": "invalid_code"}

    referrer_user_id = str(referrer.get("user_id") or referrer.get("id") or "").strip()
    if not referrer_user_id:
        return await get_coin_state(user_id), {"applied": False, "reason": "invalid_code"}

    def mutator(item: Dict[str, Any]) -> MutationPayload:
        own_code = str(item.get("referral_code") or "").upper()
        if normalized_code == own_code:
            return False, {"applied": False, "reason": "self_referral"}
        existing_referred_by = str(item.get("referred_by") or "").strip().upper()
        if existing_referred_by and existing_referred_by != normalized_code:
            return False, {"applied": False, "reason": "already_referred"}

        if existing_referred_by == normalized_code:
            return False, {
                "applied": False,
                "reason": "already_referred",
                "sync_referrer_reward": True,
            }

        item["referred_by"] = normalized_code
        item["balance"] = _coerce_int(item.get("balance"), 0) + REWARDS["REFERRAL_RECEIVER"]
        item["lifetime_earned"] = _coerce_int(item.get("lifetime_earned"), 0) + REWARDS["REFERRAL_RECEIVER"]
        item.setdefault("transactions", []).insert(
            0,
            _new_transaction(
                amount=REWARDS["REFERRAL_RECEIVER"],
                reason=f"Referral bonus — code {normalized_code}",
                category="referral",
            ),
        )
        return True, {"applied": True, "reason": None}

    coin_state, result = await _mutate_coin_state(user_id, mutator)
    should_sync_referrer_reward = bool(result.pop("sync_referrer_reward", False))
    if not result.get("applied") and not should_sync_referrer_reward:
        return coin_state, result

    def referrer_mutator(item: Dict[str, Any]) -> MutationPayload:
        rewarded_users = _sanitize_referral_rewarded_users(item.get("referral_rewarded_users"))
        if user_id in rewarded_users:
            return False, None

        item["referral_rewarded_users"] = [*rewarded_users, user_id]
        item["referral_count"] = _coerce_int(item.get("referral_count"), 0) + 1
        item["balance"] = _coerce_int(item.get("balance"), 0) + REWARDS["REFERRAL_SENDER"]
        item["lifetime_earned"] = _coerce_int(item.get("lifetime_earned"), 0) + REWARDS["REFERRAL_SENDER"]
        item.setdefault("transactions", []).insert(
            0,
            _new_transaction(
                amount=REWARDS["REFERRAL_SENDER"],
                reason=f"Friend used your referral code ({user_id})",
                category="referral",
            ),
        )
        return True, None

    await _mutate_coin_state(referrer_user_id, referrer_mutator)
    return coin_state, result
