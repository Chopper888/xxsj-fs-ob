import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime
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
    parser.add_argument("--test-id", required=True)
    args = parser.parse_args()

    tenant_token = Path(args.token_file).read_text(encoding="utf-8").strip()
    fields_data = request(args.app_token, args.table_id, tenant_token, "/fields?page_size=100")
    fields = fields_data.get("items", [])
    Path(args.backup).parent.mkdir(parents=True, exist_ok=True)
    Path(args.backup).write_text(json.dumps(fields, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"BACKUP:{args.backup}:FIELDS={len(fields)}")

    by_name = {field["field_name"]: field for field in fields}
    required = [
        ("重试次数", 2, {"formatter": "0"}),
        ("最近错误", 1, None),
        ("处理时间", 5, {"date_formatter": "yyyy-MM-dd HH:mm"}),
    ]
    if "知识库链接" not in by_name and "知识库路径" not in by_name:
        required.append(("知识库路径", 1, None))

    for name, field_type, property_value in required:
        if name in by_name:
            print(f"FIELD_EXISTS:{name}:{by_name[name]['field_id']}")
            continue
        payload = {"field_name": name, "type": field_type}
        if property_value is not None:
            payload["property"] = property_value
        created = request(args.app_token, args.table_id, tenant_token, "/fields", "POST", payload)["field"]
        by_name[name] = created
        print(f"FIELD_CREATED:{name}:{created['field_id']}")

    record_id = None
    try:
        created = request(
            args.app_token,
            args.table_id,
            tenant_token,
            "/records",
            "POST",
            {"fields": {"标题": args.test_id, "去重ID": args.test_id, "来源平台": "其他", "处理状态": "pending", "重试次数": 0}},
        )
        record_id = created["record"]["record_id"]
        print(f"TEST_CREATED:{record_id}")

        transitions = [
            ("pending", {"处理状态": "pending", "重试次数": 0, "最近错误": ""}),
            ("processing", {"处理状态": "processing"}),
            ("failed", {"处理状态": "failed", "重试次数": 1, "最近错误": "schema-transition-test"}),
            ("pending", {"处理状态": "pending", "最近错误": ""}),
            ("processing", {"处理状态": "processing"}),
            ("done", {"处理状态": "done", "处理时间": int(time.time() * 1000), "知识库路径": f"obsidian://schema-test/{args.test_id}"}),
        ]
        for expected, update_fields in transitions:
            request(args.app_token, args.table_id, tenant_token, f"/records/{record_id}", "PUT", {"fields": update_fields})
            record = request(args.app_token, args.table_id, tenant_token, f"/records/{record_id}")["record"]
            actual = record["fields"].get("处理状态")
            if actual != expected:
                raise AssertionError(f"state_mismatch:{expected}:{actual}")
            print(f"STATE_OK:{expected}:retry={record['fields'].get('重试次数')}:error={bool(record['fields'].get('最近错误'))}")
    finally:
        if record_id:
            request(args.app_token, args.table_id, tenant_token, f"/records/{record_id}", "DELETE")
            print(f"TEST_DELETED:{record_id}")

    final_fields = request(args.app_token, args.table_id, tenant_token, "/fields?page_size=100").get("items", [])
    status = next(field for field in final_fields if field["field_name"] == "处理状态")
    options = [option["name"] for option in status.get("property", {}).get("options", [])]
    print("STATUS_OPTIONS:" + ",".join(options))
    print("FINAL_FIELDS:" + ",".join(field["field_name"] for field in final_fields))


if __name__ == "__main__":
    main()
