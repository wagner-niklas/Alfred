---
name: data-analysis
description: Structured, tool-driven analysis for any data or database question. Always consult this skill before running queries.
license: ...
---

This skill defines how to analyze data and database questions in a reliable, reproducible, and tool-driven way. For any question that depends on data (numbers, metrics, tables, reports, or internal knowledge), you MUST use the available tools to look up information instead of guessing.

General principles:

- Do **not** guess or fabricate any content. Always use tools to retrieve and verify data.
- Always follow the workflow below. If any step fails, pause, rethink, adjust, and retry.
- Answer in the language of the user's question. Keep responses concise, structured, and actionable.
- Do **not** provide file downloads or data exports.
- Systematically investigate relevant concepts, tables, columns, and values for every question.
- Do **not** expose technical details about database internals or query execution errors unless the user explicitly asks. Prefer business-readable explanations and final conclusions.

If tools or data are unavailable, clearly state the limitation and avoid speculating. Offer alternative ways the user could obtain the required data instead of making up numbers.

## Mandatory workflow for every data or database question

### Goal
Provide trustworthy, reproducible answers to data and database questions using Alfred's tools and connected data sources.

### Required tool order

#### 1. `tool_thinking_tool`
Clarify and structure the question before touching any data:

- Identify the business intent or goal.
- Identify relevant entities (for example: company, customer, product, region, year).
- Identify required timeframes, filters, and comparison groups.
- Identify the expected output format (numbers, table, list, explanation, summary).

Only proceed once the question is clearly defined and you have a concrete plan for what data is needed.

#### 2. `tool_neo4j_query`
Investigate the semantic knowledge store to reuse existing knowledge whenever possible:

- Search for related concepts or prior analyses that match the business intent.
- Look for overlapping tables, columns, or metrics that are relevant.
- Reuse or adapt existing query patterns instead of starting from scratch when appropriate.

If no relevant concepts or patterns exist, proceed by designing a new, clear query plan based on the clarified question.

#### 3. `tool_sql_db_query`
Execute the planned or adapted SQL query against the database:

- Translate the plan into precise SQL using the tables, columns, and filters identified in previous steps.
- Use safe defaults (for example, reasonable limits) to avoid overly large or unsafe queries.
- Check that joins, filters, and data types are correct before executing.

If the query fails:

- Carefully read the error message (schema, table/column names, types, or syntax).
- Adjust the query based on the error (for example, fix a column name, join condition, or filter) and retry.
- Do not retry blindly. After one or two careful attempts, if the query still fails, stop and explain the limitation to the user in clear language.

When the query succeeds:

- Interpret the results in plain language.
- Highlight key findings, caveats, and any assumptions.
- If the data is inconclusive or incomplete, say so explicitly rather than over-claiming.