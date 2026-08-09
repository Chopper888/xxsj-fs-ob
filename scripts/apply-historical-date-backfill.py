import hashlib
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT / "docs" / "historical-date-backfill-preview-20260802.json"
HELPER = Path(os.environ.get("FEISHU_BITABLE_HELPER", ""))
TARGET_FIELDS = ("日期", "收藏时间", "最近错误")
ALLOWED_CHANGES = {"日期", "收藏时间"}


def load_helper():
    spec = importlib.util.spec_from_file_location("feishu_bitable", HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_api_success(response, stage):
    if response.get("code") != 0:
        raise RuntimeError(f"{stage}_failed:{response.get('code')}:{response.get('msg')}")
    return response["data"]


def fields_for_record(module, record_id):
    data = require_api_success(module.api(f"/records/{record_id}"), f"read_{record_id}")
    return data["record"]["fields"]


def restore_record(module, record_id, snapshot_fields):
    payload = {name: snapshot_fields.get(name) for name in TARGET_FIELDS}
    response = module.api(f"/records/{record_id}", "PUT", {"fields": payload})
    require_api_success(response, f"rollback_{record_id}")
    restored = fields_for_record(module, record_id)
    if any(restored.get(name) != snapshot_fields.get(name) for name in TARGET_FIELDS):
        raise RuntimeError(f"rollback_readback_mismatch:{record_id}")


def main():
    module = load_helper()
    preview_bytes = PREVIEW.read_bytes()
    preview = json.loads(preview_bytes.decode("utf-8"))
    rows = preview["record_preview"]
    if len(rows) != 8 or len({row["record_id"] for row in rows}) != 8:
        raise RuntimeError("preview_must_contain_exactly_8_unique_records")

    fields = require_api_success(module.api("/fields?page_size=100"), "list_fields")["items"]
    records = require_api_success(module.api("/records?page_size=100"), "list_records")["items"]
    if len(fields) != 16 or len(records) != 9:
        raise RuntimeError(f"base_shape_changed:fields={len(fields)}:records={len(records)}")

    by_id = {record["record_id"]: record["fields"] for record in records}
    if not all(row["record_id"] in by_id for row in rows):
        raise RuntimeError("preview_record_missing_from_base")
    for row in rows:
        if by_id[row["record_id"]].get("日期") != row["current_base_date_raw"]:
            raise RuntimeError(f"precondition_date_changed:{row['record_id']}")
        if by_id[row["record_id"]].get("收藏时间") is not None:
            raise RuntimeError(f"precondition_collection_time_changed:{row['record_id']}")

    stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    snapshot_path = ROOT / "docs" / f"historical-date-backfill-snapshot-{stamp}.json"
    diff_path = ROOT / "docs" / f"historical-date-backfill-diff-{stamp}.json"
    snapshot = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "preview_path": str(PREVIEW),
        "preview_sha256": hashlib.sha256(preview_bytes).hexdigest(),
        "records": [
            {
                "record_id": row["record_id"],
                "fields": {name: by_id[row["record_id"]].get(name) for name in TARGET_FIELDS},
            }
            for row in rows
        ],
    }
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    success = 0
    failures = 0
    rollbacks = 0
    changes = []
    for row in rows:
        record_id = row["record_id"]
        before = dict(by_id[record_id])
        update_fields = {
            "日期": row["suggested_publish_date_ms"],
            "收藏时间": row["suggested_collection_time_ms"],
        }
        try:
            require_api_success(
                module.api(f"/records/{record_id}", "PUT", {"fields": update_fields}),
                f"update_{record_id}",
            )
            after = fields_for_record(module, record_id)
            if after.get("日期") != update_fields["日期"] or after.get("收藏时间") != update_fields["收藏时间"]:
                raise RuntimeError(f"readback_mismatch:{record_id}")
            changed_keys = {key for key in set(before) | set(after) if before.get(key) != after.get(key)}
            if not changed_keys.issubset(ALLOWED_CHANGES):
                raise RuntimeError(f"unexpected_fields_changed:{record_id}:{sorted(changed_keys)}")
            changes.append(
                {
                    "record_id": record_id,
                    "before": {name: before.get(name) for name in TARGET_FIELDS},
                    "after": {name: after.get(name) for name in TARGET_FIELDS},
                    "changed_fields": sorted(changed_keys),
                }
            )
            success += 1
            print(f"RECORD_OK:{record_id}:date={after.get('日期')}:collection={after.get('收藏时间')}")
        except Exception:
            failures += 1
            restore_record(module, record_id, before)
            rollbacks += 1
            raise

    report = {
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "preview_path": str(PREVIEW),
        "preview_sha256": hashlib.sha256(preview_bytes).hexdigest(),
        "snapshot_path": str(snapshot_path),
        "success_count": success,
        "failure_count": failures,
        "rollback_count": rollbacks,
        "allowed_changed_fields": sorted(ALLOWED_CHANGES),
        "records": changes,
    }
    diff_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"SNAPSHOT:{snapshot_path}")
    print(f"DIFF:{diff_path}")
    print(f"SUMMARY:success={success}:failure={failures}:rollback={rollbacks}")


if __name__ == "__main__":
    main()
