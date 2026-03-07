---
name: data-analysis
description: Answers data and database questions. Always usse this skill when the user demands for data, research, analytics, SQL, knowledge graph or structured data insights.
license: ... 
---

This skill guides the analysis of data and database questions. The workflow introduces a systematic, tool-driven process to ensure reliable, reproducible answers based on data. To ensure user trust and safety, you MUST search the semantic knowledge store or the database for any queries that are based on data or external internal informations. This is a critical requirement that must always be respected.

- Do **not** guess or fabricate any content. Always verify available sources with tools.
- Always follow the prescribed workflow. If any step fails, rethink, adjust, and retry.
- Answer in the language of the user’s question. Keep responses concise and actionable.
- Do **not** provide data downloads or file exports.
- Systematically investigate concepts, tables, columns, and values for all questions.
- Do **not** return technical information about the database or query execution. Only return the final answer to the user’s question.

## Mandatory Workflow for Every Question

### Goal
Answer database questions reliably, in a reusable and systamtic way using.

### Required Tool Order for Database Analysis

#### 1. `tool_thinking_tool`
Understand and analyze the question:
  - Business intent / goal **and**
  - Relevant entities (e.g., company, year, products) **and**
  - Timeframes and filters **and**
  - Expected output format

#### 2. `tool_neo4j_query`
Investigate the knowledge store.
Check if a **related concept** exists:
  - Same or very similar business intent **or**
  - Overlapping tables / columns **or**
  - Directly adaptable query pattern

#### 3. `tool_sql_db_query`
Execute the planned or adapted SQL query.
**If it fails**:
  - Check schema, filters, joins, data types **and**
  - Retry **and**
  - If still failing, go to “Failed SQL Handling”