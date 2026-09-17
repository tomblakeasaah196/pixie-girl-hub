#!/usr/bin/env python3
"""
Harness for tests/unit/tasks/board-visibility.test.js.

Executes the SQL that src/shared/tasks/tasks.repo.js actually emitted (captured
by the jest test from the mocked query function) against a real SQL engine, so
the claim "NULL-assigned rows are excluded" is demonstrated rather than
asserted from a reading of the string.

No Postgres is available in this sandbox; sqlite3 stands in. The only
translation applied is the Postgres-only `::int` cast (dropped) and `$N`
bind markers -> `?`. Neither touches the WHERE clause under test, and
NULL = '<value>' evaluating to NULL (so the row is not returned) is standard
SQL, identical in Postgres and SQLite.
"""
import json
import re
import sqlite3
import sys

spec = json.load(sys.stdin)
sql, params, me, brand = spec["sql"], spec["params"], spec["me"], spec["brand"]

conn = sqlite3.connect(":memory:")
conn.execute("ATTACH DATABASE ':memory:' AS shared")

conn.executescript(
    """
    CREATE TABLE shared.users (
        user_id TEXT PRIMARY KEY,
        display_name TEXT
    );
    CREATE TABLE shared.tasks (
        task_id TEXT PRIMARY KEY,
        business TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        assigned_to TEXT,
        created_by TEXT NOT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        due_at TEXT,
        created_at TEXT
    );
    CREATE TABLE shared.task_subtasks (
        subtask_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        is_done INTEGER NOT NULL DEFAULT 0
    );
    """
)

conn.execute("INSERT INTO shared.users VALUES (?, ?)", (me, "Me"))
conn.execute(
    "INSERT INTO shared.users VALUES (?, ?)",
    ("22222222-2222-2222-2222-222222222222", "Someone Else"),
)

# The two tasks created from the Workspace form: assigned_to is NULL (the
# bug), created_by is the signed-in user.
conn.execute(
    "INSERT INTO shared.tasks VALUES ('t1', ?, 'unassigned-1', 'to_do', "
    "'normal', NULL, ?, 0, NULL, '2026-09-17')",
    (brand, me),
)
conn.execute(
    "INSERT INTO shared.tasks VALUES ('t2', ?, 'unassigned-2', 'to_do', "
    "'normal', NULL, ?, 0, NULL, '2026-09-17')",
    (brand, me),
)
# A control row: same brand, same creator, but actually assigned.
conn.execute(
    "INSERT INTO shared.tasks VALUES ('t3', ?, 'assigned-to-me', 'to_do', "
    "'normal', ?, ?, 0, NULL, '2026-09-17')",
    (brand, me, me),
)

# Postgres -> sqlite dialect shim for the captured SQL. `$N` becomes `?N`
# (not a bare `?`) because the "mine" predicate reuses one bind marker twice —
# `t.assigned_to = $2 OR t.created_by = $2` — and numbered markers preserve
# that reuse where positional `?` would demand a third value.
portable = sql.replace("::int", "")
portable = re.sub(r"\$(\d+)", r"?\1", portable)

rows = conn.execute(portable, params).fetchall()
titles = [r[2] for r in rows]  # t.* ordering: task_id, business, title, ...

all_rows = conn.execute("SELECT title FROM shared.tasks").fetchall()
unassigned = conn.execute(
    "SELECT count(*) FROM shared.tasks WHERE assigned_to IS NULL"
).fetchone()[0]

print(
    json.dumps(
        {
            "total_rows_in_table": len(all_rows),
            "unassigned_rows_in_table": unassigned,
            "board_returned": titles,
            "sql_where": sql[sql.rindex("WHERE") : sql.index("ORDER BY")].strip(),
        }
    )
)
