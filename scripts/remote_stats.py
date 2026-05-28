import mysql.connector, json, sys

try:
    conn = mysql.connector.connect(
        host=sys.argv[1] if len(sys.argv) > 1 else 'localhost',
        user=sys.argv[2] if len(sys.argv) > 2 else 'root',
        password=sys.argv[3] if len(sys.argv) > 3 else '',
        database='gateway'
    )
except mysql.connector.Error as err:
    print(json.dumps({"error": str(err)}))
    sys.exit(1)

cur = conn.cursor()
queries = {
    "total_2xx": "SELECT COUNT(*) FROM request_logs WHERE status_code BETWEEN 200 AND 299",
    "counted_2xx": "SELECT COUNT(*) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND is_counted_request=1",
    "counted_valid_tokens": "SELECT COUNT(*) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND is_counted_request=1 AND prompt_tokens>0 AND completion_tokens>0",
    "sum_prompt_tokens": "SELECT SUM(prompt_tokens) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND is_counted_request=1",
    "sum_completion_tokens": "SELECT SUM(completion_tokens) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND is_counted_request=1"
}
results = {}
for k, q in queries.items():
    cur.execute(q)
    results[k] = cur.fetchone()[0]
print(json.dumps(results))
conn.close()
