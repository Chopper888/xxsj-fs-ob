import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path


def request(app_token, table_id, tenant_token, path, method="GET", body=None):
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}{path}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tenant_token}")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        result = json.loads(error.read().decode("utf-8"))
    if result.get("code") != 0:
        raise RuntimeError(f"api_failed:{result.get('code')}:{result.get('msg')}")
    return result.get("data", {})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-token", required=True)
    parser.add_argument("--table-id", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--backup", required=True)
    args = parser.parse_args()

    token = Path(args.token_file).read_text(encoding="utf-8").strip()
    fields = request(args.app_token, args.table_id, token, "/fields?page_size=100").get("items", [])
    if len(fields) != 15:
        raise RuntimeError(f"expected_15_fields_before_migration:actual={len(fields)}")
    Path(args.backup).write_text(json.dumps(fields, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"BACKUP_OK:{args.backup}:FIELDS={len(fields)}")

    by_name = {field["field_name"]: field for field in fields}
    if "收藏时间" in by_name:
        print(f"FIELD_EXISTS:收藏时间:{by_name['收藏时间']['field_id']}")
        return
    created = request(
        args.app_token,
        args.table_id,
        token,
        "/fields",
        "POST",
        {"field_name": "收藏时间", "type": 5, "property": {"date_formatter": "yyyy-MM-dd HH:mm"}},
    )["field"]
    print(f"FIELD_CREATED:收藏时间:{created['field_id']}")

    final_fields = request(args.app_token, args.table_id, token, "/fields?page_size=100").get("items", [])
    if len(final_fields) != 16 or "收藏时间" not in {field["field_name"] for field in final_fields}:
        raise RuntimeError("post_migration_schema_verification_failed")
    print("VERIFY_OK:FIELDS=16")


if __name__ == "__main__":
    main()
