"""
Feedback Engine Lambda handler — processes feedback generation jobs from SQS.
Receives SQS events, extracts job details, invokes the feedback generation,
and persists results to the database.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
import uuid
import hashlib

import psycopg
import boto3
from botocore.exceptions import BotoCoreError, ClientError

from wren_engine.prompt_assembly import (
    PromptAssembler,
    SystemScaffolding,
    DocumentTypePromptConfig,
    UntrustedContent,
)
from wren_engine.diff_engine import DiffEngine
from wren_engine.anchor_service import AnchorService
from wren_engine.anchor_service import compute_fingerprint as compute_anchor_fingerprint
from wren_engine.carry_forward import (
    CarryForwardCache,
    CachedFeedbackItem,
    CacheKey,
    ConfigSnapshot,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem
from wren_engine.structural_feedback import StructuralFeedbackItem
from wren_engine.progress_tracker import (
    FeedbackItem as TrackerFeedbackItem,
    ProgressTracker,
    ResolutionStatus,
)
from wren_engine.models import Segment, Span

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_SYSTEM_CORE = (
    "You are WREN, a Socratic writing coach. Your sole task is to generate "
    "structured feedback on the submitted document using the taxonomy provided. "
    "Ask probing questions that guide the writer toward improvement without "
    "providing replacement prose or rewriting their work."
)
_OUTPUT_SCHEMA = """\
Return a JSON array. Each element must have exactly these keys:
  error_category_id: string  — must be the exact UUID from the taxonomy list below, not the name
  kind: "inline" | "structural"
  question_text: string  — a Socratic question, never a correction or rewrite
  anchor: { paragraphIndex: int, startOffset: int, endOffset: int } | null  — required for inline, null for structural
Only output valid JSON. No markdown fences, no extra keys, no prose outside the array.
inline items MUST have a valid anchor. structural items MUST have anchor: null."""
_GUARDRAIL = (
    "NEVER provide replacement prose, rewrites, corrections, or any text the writer "
    "could paste directly into their document. Every piece of feedback must be a "
    "Socratic question or observation, never a suggested revision."
)

_SCAFFOLDING = SystemScaffolding(
    core_instructions=_SYSTEM_CORE,
    output_schema_text=_OUTPUT_SCHEMA,
    guardrail_text=_GUARDRAIL,
)
_ASSEMBLER = PromptAssembler()


def get_db_connection():
    """Get database connection from Secrets Manager."""
    try:
        secrets_client = boto3.client('secretsmanager', region_name=os.getenv('AWS_REGION', 'ca-central-1'))
        secret_arn = os.getenv('DB_SECRET_ARN')

        secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
        secret = json.loads(secret_response['SecretString'])

        host = os.getenv('DB_PROXY_HOST') or secret['host']
        conn = psycopg.connect(
            host=host,
            port=secret['port'],
            dbname=secret['dbname'],
            user=secret['username'],
            password=secret['password'],
            sslmode='require'
        )
        return conn
    except (BotoCoreError, ClientError, Exception) as e:
        logger.error(f"Failed to get database connection: {str(e)}")
        raise


def load_prompt_config(document_type_id: str, conn: psycopg.Connection) -> dict[str, Any]:
    """Load prompt configuration from database."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COALESCE(type_prompt_text, 'You are WREN, a Socratic writing coach. Your role is to guide writers toward excellence through thoughtful questions rather than direct answers.'),
                    COALESCE(tone, 'supportive'),
                    COALESCE(density, 'moderate'),
                    COALESCE(tone_description, 'Be supportive and encouraging while maintaining high expectations.'),
                    COALESCE(density_description, 'Provide feedback across multiple dimensions of writing quality, focusing on the most impactful improvements.'),
                    COALESCE(category_priority, '[]'::jsonb),
                    structure_description,
                    restrictions_description,
                    notes_description,
                    updated_at
                FROM document_type_config
                WHERE document_type_id = %s
            """, (document_type_id,))

            result = cur.fetchone()

            # Load the runtime model override from platform_usage_policy (set by TechnicalAdmin).
            cur.execute('SELECT bedrock_model_id FROM platform_usage_policy WHERE id = 1')
            policy_row = cur.fetchone()
            bedrock_model_id = policy_row[0] if policy_row and policy_row[0] else None

            if result:
                return {
                    'type_prompt_text': result[0],
                    'tone': result[1],
                    'density': result[2],
                    'tone_description': result[3],
                    'density_description': result[4],
                    'category_priority': json.loads(result[5]) if isinstance(result[5], str) else result[5],
                    'structure_description': result[6],
                    'restrictions_description': result[7],
                    'notes_description': result[8],
                    'updated_at': result[9],
                    'temperature': 0.7,
                    'bedrock_model_id': bedrock_model_id,
                }

            # Return default config if no row exists yet for this document type
            return {
                'type_prompt_text': 'You are WREN, a Socratic writing coach. Your role is to guide writers toward excellence through thoughtful questions rather than direct answers.',
                'tone': 'supportive',
                'density': 'moderate',
                'tone_description': 'Be supportive and encouraging while maintaining high expectations.',
                'density_description': 'Provide feedback across multiple dimensions of writing quality, focusing on the most impactful improvements.',
                'category_priority': [],
                'structure_description': None,
                'restrictions_description': None,
                'notes_description': None,
                'updated_at': None,
                'temperature': 0.7,
                'bedrock_model_id': bedrock_model_id,
            }
    except Exception as e:
        logger.error(f"Error loading prompt config: {str(e)}")
        raise


def load_draft_segments(draft_id: str, conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Load draft segments from database."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT segments FROM draft WHERE id = %s
            """, (draft_id,))

            result = cur.fetchone()
            if result and result[0]:
                return json.loads(result[0])

            return []
    except Exception as e:
        logger.error(f"Error loading draft segments: {str(e)}")
        raise


def load_document_type_meta(document_type_id: str, conn: psycopg.Connection) -> dict[str, Any]:
    """Return { name, category_names, category_ids, category_guidance } for a document type.

    category_guidance maps category_id -> internal_guidance (may be None).
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name FROM document_type WHERE id = %s",
                (document_type_id,),
            )
            row = cur.fetchone()
            doc_type_name = row[0] if row else "Unknown Document Type"

            cur.execute(
                "SELECT id, name, internal_guidance FROM error_category WHERE document_type_id = %s ORDER BY name ASC",
                (document_type_id,),
            )
            cat_rows = cur.fetchall()
            category_ids = [r[0] for r in cat_rows]
            category_names = [r[1] for r in cat_rows]
            category_guidance = {r[0]: r[2] for r in cat_rows}

        return {
            "name": doc_type_name,
            "category_ids": category_ids,
            "category_names": category_names,
            "category_guidance": category_guidance,
        }
    except Exception as e:
        logger.error(f"Error loading document type meta: {str(e)}")
        return {"name": "Unknown Document Type", "category_ids": [], "category_names": [], "category_guidance": {}}


def load_department_prompt(document_type_id: str, conn: psycopg.Connection) -> str:
    """Return the department-level prompt for the given document type, or empty string."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT d.prompt
                FROM document_type dt
                JOIN department d ON d.id = dt.department_id
                WHERE dt.id = %s
            """, (document_type_id,))
            row = cur.fetchone()
            return (row[0] or '') if row else ''
    except Exception as e:
        logger.error(f"Error loading department prompt: {str(e)}")
        return ''


def load_reference_material(writing_type_id: str) -> list[dict[str, Any]]:
    """Load reference material from S3."""
    try:
        s3_client = boto3.client('s3', region_name=os.getenv('AWS_REGION', 'ca-central-1'))
        bucket = os.getenv('REFERENCE_BUCKET_NAME')
        prefix = f"document-types/{writing_type_id}/"

        materials = []
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket, Prefix=prefix)

        for page in pages:
            for obj in page.get('Contents', []):
                try:
                    response = s3_client.get_object(Bucket=bucket, Key=obj['Key'])
                    content = response['Body'].read().decode('utf-8')
                    title = obj['Key'].split('/')[-1].replace('.txt', '')
                    materials.append({'title': title, 'content': content})
                except Exception as e:
                    logger.warning(f"Failed to load reference material {obj['Key']}: {str(e)}")

        return materials
    except Exception as e:
        logger.error(f"Error loading reference material: {str(e)}")
        return []


def assemble_prompt(
    config: dict[str, Any],
    doc_type_meta: dict[str, Any],
    department_prompt: str,
    segments: list[dict[str, Any]],
    reference_materials: list[dict[str, Any]],
    *,
    focus_paragraph_indices: set[int] | None = None,
) -> str:
    """Assemble the layered prompt for Bedrock using PromptAssembler."""
    if focus_paragraph_indices is not None:
        para_lines = []
        for i, seg in enumerate(segments):
            text = seg.get('text', '')
            if i in focus_paragraph_indices:
                para_lines.append(f"[PARAGRAPH {i} — EVALUATE THIS]\n{text}")
            else:
                para_lines.append(f"[PARAGRAPH {i} — context only, do NOT generate feedback]\n{text}")
        doc_text = '\n\n'.join(para_lines)
    else:
        doc_text = '\n'.join([seg.get('text', '') for seg in segments if 'text' in seg])

    # Build type instructions: department-level prompt first, then doc-type fields
    type_instruction_parts = []
    if department_prompt.strip():
        type_instruction_parts.append(f"Department Instructions:\n{department_prompt.strip()}")
    base_instructions = config.get('type_prompt_text', '')
    if base_instructions:
        type_instruction_parts.append(base_instructions)
    for field_label, field_key in [
        ('Structure & Organization', 'structure_description'),
        ("Restrictions & Don'ts", 'restrictions_description'),
        ('Additional Notes', 'notes_description'),
    ]:
        value = config.get(field_key) or ''
        if value.strip():
            type_instruction_parts.append(f"{field_label}: {value.strip()}")

    type_instructions = '\n\n'.join(type_instruction_parts)

    if focus_paragraph_indices is not None:
        type_instructions += (
            f"\n\nFOCUS DIRECTIVE: Generate feedback ONLY for paragraphs marked "
            f"'EVALUATE THIS' (indices: {sorted(focus_paragraph_indices)}). "
            f"Other paragraphs are provided for context only. Do not generate "
            f"any feedback items anchored to context-only paragraphs."
        )

    # Tone description goes into the grounding note as plain text.
    tone_desc = config.get('tone_description', '')
    grounding_note = f"Tone: {tone_desc}" if tone_desc else ''

    # Parse per-category overrides stored as JSON in density_description.
    # Shape: { "v": 1, "overrides": { "<categoryId>": { "definition": str, "criteria": str, "frameworkKey": str } } }
    # Fallback: treat as plain text for legacy rows.
    raw_density = config.get('density_description', '') or ''
    category_overrides: dict[str, dict] = {}
    if raw_density.strip().startswith('{'):
        try:
            parsed = json.loads(raw_density)
            if parsed.get('v') == 1:
                category_overrides = parsed.get('overrides', {})
        except (json.JSONDecodeError, AttributeError):
            pass

    # Build an explicit id→name taxonomy the model must use for error_category_id.
    # Append per-category definition and success criteria where the admin has set them,
    # falling back to internal_guidance from the DB row.
    category_ids = doc_type_meta.get('category_ids', [])
    category_names_list = doc_type_meta.get('category_names', [])
    category_guidance = doc_type_meta.get('category_guidance', {})

    taxonomy_lines = []
    criteria_blocks = []
    for cid, cname in zip(category_ids, category_names_list):
        if not cid or not cname:
            continue
        taxonomy_lines.append(f"  {cid}: {cname}")
        override = category_overrides.get(cid, {})
        definition = (override.get('definition') or '').strip()
        criteria = (override.get('criteria') or '').strip()
        db_guidance = (category_guidance.get(cid) or '').strip()
        # Use admin-supplied definition first, then DB internal_guidance as fallback
        effective_definition = definition or db_guidance
        if effective_definition or criteria:
            block_parts = [f"[{cname}]"]
            if effective_definition:
                block_parts.append(f"  Definition: {effective_definition}")
            if criteria:
                block_parts.append(f"  Success criteria: {criteria}")
            criteria_blocks.append('\n'.join(block_parts))

    if taxonomy_lines:
        taxonomy_block = "Feedback taxonomy (use the UUID as error_category_id):\n" + "\n".join(taxonomy_lines)
        type_instructions = taxonomy_block + ("\n\n" + type_instructions if type_instructions else "")

    if criteria_blocks:
        criteria_section = "Per-category evaluation criteria:\n" + "\n\n".join(criteria_blocks)
        type_instructions = (type_instructions + "\n\n" + criteria_section) if type_instructions else criteria_section

    doc_type_config = DocumentTypePromptConfig(
        document_type_name=doc_type_meta.get('name', 'Unknown Document Type'),
        category_names=tuple(category_names_list),
        tone=config.get('tone', 'supportive'),
        density=config.get('density', 'moderate'),
        category_priority=tuple(config.get('category_priority', [])),
        type_instructions=type_instructions,
        reference_grounding_note=grounding_note,
    )

    untrusted: list[UntrustedContent] = []
    for material in reference_materials:
        untrusted.append(UntrustedContent(
            label=f"REFERENCE MATERIAL: {material['title']}",
            text=material['content'],
        ))
    untrusted.append(UntrustedContent(
        label="SUBMITTED DOCUMENT",
        text=doc_text,
    ))

    assembled = _ASSEMBLER.assemble(_SCAFFOLDING, doc_type_config, untrusted)

    # invoke_bedrock expects a single string; we pass system + user together
    # separated by a clear marker so invoke_bedrock can split them if needed,
    # or pass the full combined text as the user message for single-turn models.
    return assembled.system_message + "\n\n---\n\n" + assembled.user_message


def invoke_bedrock(prompt: str, config: dict[str, Any]) -> str:
    """Invoke Bedrock Claude model.

    `prompt` is produced by assemble_prompt as "system_message\\n\\n---\\n\\nuser_message".
    We split on that sentinel so the system instructions stay in the system field
    (where the model treats them as authoritative and non-overridable).
    """
    try:
        bedrock_client = boto3.client('bedrock-runtime', region_name=os.getenv('AWS_REGION', 'ca-central-1'))
        # DB override takes precedence over the deploy-time env var.
        model_id = config.get('bedrock_model_id') or os.getenv('BEDROCK_MODEL_ID', 'us.anthropic.claude-sonnet-4-6')

        sentinel = "\n\n---\n\n"
        if sentinel in prompt:
            system_text, user_text = prompt.split(sentinel, 1)
        else:
            system_text = ""
            user_text = prompt

        body: dict[str, Any] = {
            'anthropic_version': 'bedrock-2023-05-31',
            'max_tokens': 8192,
            'messages': [{'role': 'user', 'content': user_text}],
            'temperature': float(config.get('temperature', 0.7)),
        }
        if system_text:
            body['system'] = system_text

        response = bedrock_client.invoke_model(
            modelId=model_id,
            body=json.dumps(body),
        )

        output = json.loads(response['body'].read())
        return output['content'][0]['text']
    except Exception as e:
        logger.error(f"Error invoking Bedrock: {str(e)}")
        raise


def parse_feedback_output(model_output: str) -> list[dict[str, Any]]:
    """Parse feedback output from model."""
    try:
        # Extract JSON from potential markdown wrapping
        if '```json' in model_output:
            model_output = model_output.split('```json')[1].split('```')[0].strip()
        elif '```' in model_output:
            model_output = model_output.split('```')[1].split('```')[0].strip()

        items = json.loads(model_output)
        if not isinstance(items, list):
            items = [items]

        # Validate and sanitize items
        validated_items = []
        for item in items:
            if isinstance(item, dict) and 'error_category_id' in item and 'question_text' in item:
                validated_items.append(item)

        return validated_items
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse feedback JSON (possibly truncated): {str(e)}")
        # Attempt to recover complete items from a truncated JSON array by finding
        # the last complete object before the truncation point.
        try:
            last_close = model_output.rfind('}')
            if last_close > 0:
                recovered = model_output[:last_close + 1]
                # Close the array if it was truncated mid-element
                if not recovered.rstrip().endswith(']'):
                    recovered = recovered + ']'
                items = json.loads(recovered)
                if not isinstance(items, list):
                    return []
                validated_items = [
                    item for item in items
                    if isinstance(item, dict) and 'error_category_id' in item and 'question_text' in item
                ]
                logger.info(f"Recovered {len(validated_items)} items from truncated output")
                return validated_items
        except Exception:
            pass
        return []
    except Exception as e:
        logger.error(f"Error parsing feedback output: {str(e)}")
        return []


def compute_content_fingerprint(text: str, start_offset: int, end_offset: int) -> str:
    """Compute fingerprint of anchor content."""
    anchor_text = text[start_offset:end_offset]
    return hashlib.sha256(anchor_text.encode()).hexdigest()[:16]


def expand_to_word_boundaries(text: str, start: int, end: int) -> tuple[int, int]:
    """Snap offsets so saved quotes never start/end mid-word."""
    start = max(0, min(start, len(text)))
    end = max(start, min(end, len(text)))
    while start > 0 and (text[start - 1].isalnum() or text[start - 1] == "_"):
        start -= 1
    while end < len(text) and (text[end].isalnum() or text[end] == "_"):
        end += 1
    return start, end


def insert_feedback_items(
    document_id: str,
    draft_id: str,
    user_id: str,
    feedback_items: list[dict[str, Any]],
    segments: list[dict[str, Any]],
    conn: psycopg.Connection
) -> int:
    """Insert feedback items and anchors into database."""
    try:
        item_count = 0
        with conn.cursor() as cur:
            for item in feedback_items:
                try:
                    # Extract quoted text from the segment using anchor offsets
                    quoted_text = None
                    if item.get('kind') == 'inline' and 'anchor' in item:
                        anchor_data = item['anchor']
                        para_index = anchor_data.get('paragraphIndex', 0)
                        start_offset = anchor_data.get('startOffset', 0)
                        end_offset = anchor_data.get('endOffset', 0)
                        if para_index < len(segments):
                            para_text = segments[para_index].get('text', '')
                            if end_offset > start_offset:
                                start_offset, end_offset = expand_to_word_boundaries(
                                    para_text, start_offset, end_offset
                                )
                                # Keep expanded offsets on the item for the anchor insert below.
                                anchor_data['startOffset'] = start_offset
                                anchor_data['endOffset'] = end_offset
                                if end_offset <= len(para_text):
                                    quoted_text = para_text[start_offset:end_offset]

                    # Insert feedback item
                    feedback_id = str(uuid.uuid4())
                    cur.execute("""
                        INSERT INTO feedback_item
                        (id, document_id, error_category_id, kind, question_text, quoted_text, source_draft_id, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    """, (
                        feedback_id,
                        document_id,
                        item.get('error_category_id', 'unknown'),
                        item.get('kind', 'inline'),
                        item.get('question_text', ''),
                        quoted_text,
                        draft_id
                    ))

                    # Insert anchor if provided and inline feedback
                    current_anchor_id = None
                    if item.get('kind') == 'inline' and 'anchor' in item:
                        anchor_data = item['anchor']
                        para_index = anchor_data.get('paragraphIndex', 0)
                        start_offset = anchor_data.get('startOffset', 0)
                        end_offset = anchor_data.get('endOffset', 0)

                        # Get paragraph text for fingerprint
                        para_text = ''
                        if para_index < len(segments):
                            para_text = segments[para_index].get('text', '')

                        content_fp = compute_content_fingerprint(para_text, start_offset, end_offset)

                        anchor_id = str(uuid.uuid4())
                        cur.execute("""
                            INSERT INTO anchor
                            (id, feedback_item_id, draft_id, paragraph_index, start_offset, end_offset, content_fingerprint, state)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, 'active')
                        """, (
                            anchor_id,
                            feedback_id,
                            draft_id,
                            para_index,
                            start_offset,
                            end_offset,
                            content_fp
                        ))

                        current_anchor_id = anchor_id

                    # Update feedback_item with current_anchor_id if applicable
                    if current_anchor_id:
                        cur.execute("""
                            UPDATE feedback_item SET current_anchor_id = %s WHERE id = %s
                        """, (current_anchor_id, feedback_id))

                    item_count += 1
                except Exception as e:
                    logger.warning(f"Failed to insert feedback item: {str(e)}")

        conn.commit()
        return item_count
    except Exception as e:
        logger.error(f"Error inserting feedback items: {str(e)}")
        conn.rollback()
        raise


def judge_resolutions_with_llm(
    items_to_judge: list[dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, ResolutionStatus]:
    """Batch-evaluate whether students addressed specific feedback items.

    Makes a single Bedrock call for all changed-span items, returning a map of
    item_id -> ResolutionStatus. Retries once on parse failure. Falls back to
    STILL_UNRESOLVED only for items whose verdict couldn't be parsed.

    items_to_judge: list of { id, question_text, original_text, region_text }
    """
    if not items_to_judge:
        return {}

    bedrock_client = boto3.client('bedrock-runtime', region_name=os.getenv('AWS_REGION', 'ca-central-1'))
    model_id = config.get('bedrock_model_id') or os.getenv('BEDROCK_MODEL_ID', 'us.anthropic.claude-sonnet-4-6')

    items_json = json.dumps([
        {
            'id': str(item['id']),
            'feedback_question': item['question_text'],
            'original_text': item.get('original_text', ''),
            'revised_text': item['region_text'],
        }
        for item in items_to_judge
    ], indent=2)

    system_text = (
        'You evaluate whether a student addressed specific writing feedback when revising their draft.\n'
        'For each item you receive:\n'
        '  - "feedback_question": the coaching question that was raised about their writing\n'
        '  - "original_text": the text that was originally flagged (may be empty for structural feedback)\n'
        '  - "revised_text": the relevant section from the student\'s revised draft\n\n'
        'Compare the original to the revision in light of the feedback question. '
        'Reply with exactly one verdict per item:\n'
        '  resolved   - the revision clearly and fully addresses the concern raised by the feedback\n'
        '  partial    - the revision shows meaningful progress toward addressing the feedback, but the concern is not fully resolved\n'
        '  unresolved - the revision does not address the feedback, or the relevant text is essentially unchanged\n\n'
        'When in doubt between "partial" and "unresolved", prefer "partial" if the student made any '
        'relevant change in the direction the feedback suggested.\n'
        'Reply as a JSON array of objects with "id" and "verdict" fields only. No other text.'
    )

    user_text = f'Evaluate each feedback item:\n\n{items_json}'

    body = {
        'anthropic_version': 'bedrock-2023-05-31',
        'max_tokens': 2048,
        'temperature': 0,
        'system': system_text,
        'messages': [{'role': 'user', 'content': user_text}],
    }

    def _parse_verdicts(text: str) -> dict[str, ResolutionStatus]:
        if text.startswith('```'):
            text = text.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
        # Try to recover truncated JSON (same approach as parse_feedback_output)
        try:
            verdicts = json.loads(text)
        except json.JSONDecodeError:
            last_close = text.rfind('}')
            if last_close > 0:
                recovered = text[:last_close + 1]
                if not recovered.rstrip().endswith(']'):
                    recovered = recovered + ']'
                verdicts = json.loads(recovered)
            else:
                raise

        result: dict[str, ResolutionStatus] = {}
        for v in verdicts:
            item_id = v.get('id')
            verdict = str(v.get('verdict', '')).lower()
            if verdict == 'resolved':
                result[item_id] = ResolutionStatus.RESOLVED
            elif verdict == 'partial':
                result[item_id] = ResolutionStatus.PARTIALLY_RESOLVED
            else:
                result[item_id] = ResolutionStatus.STILL_UNRESOLVED
        return result

    max_attempts = 2
    for attempt in range(max_attempts):
        try:
            response = bedrock_client.invoke_model(
                modelId=model_id,
                body=json.dumps(body),
            )
            raw = json.loads(response['body'].read())
            text = raw.get('content', [{}])[0].get('text', '').strip()
            result = _parse_verdicts(text)
            fallback_count = len(items_to_judge) - len(result)
            if fallback_count > 0:
                logger.warning(f"LLM judge: {fallback_count}/{len(items_to_judge)} items missing from response")
            return result

        except json.JSONDecodeError as e:
            if attempt < max_attempts - 1:
                logger.warning(f"LLM judge JSON parse failed (attempt {attempt + 1}), retrying: {str(e)}")
                continue
            logger.warning(f"LLM judge JSON parse failed after {max_attempts} attempts: {str(e)}")
            return {}

        except Exception as e:
            logger.warning(f"LLM resolution judge failed (attempt {attempt + 1}/{max_attempts}): {str(e)}")
            if attempt < max_attempts - 1:
                continue
            logger.warning(f"LLM resolution judge failed after {max_attempts} attempts, "
                           f"{len(items_to_judge)} items will default to still_unresolved")
            return {}

    return {}


def persist_resolution_status(
    document_id: str,
    new_draft_id: str,
    new_segments: list[dict[str, Any]],
    config: dict[str, Any],
    conn: psycopg.Connection,
) -> None:
    """Compare prior feedback items against the new draft and write resolution_status_history rows.

    Uses a single batched LLM call to evaluate whether students addressed each
    feedback item whose anchored text changed. Structural items and unchanged/removed
    anchors are handled structurally without an LLM call.
    """
    try:
        with conn.cursor() as cur:
            # Find the most recently created draft before new_draft_id
            cur.execute("""
                SELECT d.id, d.segments
                FROM draft d
                WHERE d.document_id = %s
                  AND d.id != %s
                ORDER BY d.created_at DESC
                LIMIT 1
            """, (document_id, new_draft_id))
            prev_row = cur.fetchone()
            if not prev_row:
                return  # First draft — no history to compare against

            prev_draft_id, prev_segments_raw = prev_row
            prev_segments = json.loads(prev_segments_raw) if isinstance(prev_segments_raw, str) else prev_segments_raw

            # Load prior feedback items with anchors, question_text, AND quoted_text for the judge
            cur.execute("""
                SELECT fi.id, fi.error_category_id, fi.kind, fi.question_text,
                       a.paragraph_index, a.start_offset, a.end_offset, a.content_fingerprint,
                       fi.quoted_text
                FROM feedback_item fi
                LEFT JOIN anchor a ON a.feedback_item_id = fi.id AND a.draft_id = %s
                WHERE fi.source_draft_id = %s
            """, (prev_draft_id, prev_draft_id))
            prior_items = cur.fetchall()

            if not prior_items:
                return

        # Build Segment lists for diff engine
        prev_segs = [Segment(index=s.get('index', i), text=s.get('text', ''))
                     for i, s in enumerate(prev_segments)]
        curr_segs = [Segment(index=s.get('index', i), text=s.get('text', ''))
                     for i, s in enumerate(new_segments)]

        diff = DiffEngine().compute(prev_segs, curr_segs)

        from wren_engine.anchor_service import Anchor, AnchorState
        from wren_engine.progress_tracker import JudgeInput
        tracker_items: list[TrackerFeedbackItem] = []
        structural_items: list[dict[str, Any]] = []
        question_map: dict[str, str] = {}
        quoted_text_map: dict[str, str] = {}

        for row in prior_items:
            item_id, category_id, kind, question_text = row[0], row[1], row[2], row[3]
            para_idx, start_off, end_off, fp_hex = row[4], row[5], row[6], row[7]
            item_quoted_text = row[8] if len(row) > 8 else None

            question_map[item_id] = question_text or ''
            quoted_text_map[item_id] = item_quoted_text or ''

            if kind == 'structural' or para_idx is None:
                structural_items.append({
                    'id': str(item_id),
                    'category_id': category_id,
                    'question_text': question_text or '',
                    'quoted_text': item_quoted_text or '',
                })
                continue

            prev_para_text = prev_segs[para_idx].text if para_idx < len(prev_segs) else ''
            anchor = Anchor.create(
                paragraph_text=prev_para_text,
                paragraph_index=para_idx,
                start_offset=start_off or 0,
                end_offset=end_off or 0,
                feedback_item_id=item_id,
            )
            remap = AnchorService().remap([anchor], diff)[0]
            tracker_items.append(TrackerFeedbackItem(
                item_id=item_id,
                category_id=category_id,
                remap=remap,
            ))

        # First pass: structural classification (removed/unchanged) — no LLM needed.
        # Collect items where the span actually changed — those need the LLM judge.
        from wren_engine.anchor_service import Remapped, Removed
        from wren_engine.models import ChangeKind

        changed_items: list[dict[str, Any]] = []

        def collecting_judge(judge_input: JudgeInput) -> ResolutionStatus:
            changed_items.append({
                'id': str(judge_input.item.item_id),
                'question_text': question_map.get(judge_input.item.item_id, ''),
                'original_text': quoted_text_map.get(judge_input.item.item_id, ''),
                'region_text': judge_input.region_text,
            })
            # Placeholder — real verdict comes from the batch call below.
            return ResolutionStatus.STILL_UNRESOLVED

        preliminary_updates = ProgressTracker().reevaluate(tracker_items, diff, collecting_judge)

        # Add structural items to the judge batch — they have no anchor/diff
        # but can still be evaluated using quoted_text + full revised draft.
        full_revised_text = '\n'.join(s.text for s in curr_segs)
        for si in structural_items:
            changed_items.append({
                'id': si['id'],
                'question_text': si['question_text'],
                'original_text': si['quoted_text'],
                'region_text': full_revised_text,
            })

        # Batch LLM call for all changed spans + structural items.
        llm_verdicts = judge_resolutions_with_llm(changed_items, config)

        # Final updates: replace placeholder verdicts with LLM verdicts where available.
        from wren_engine.progress_tracker import ResolutionUpdate
        final_updates = []
        for u in preliminary_updates:
            item_id_str = str(u.item_id)
            if u.status == ResolutionStatus.STILL_UNRESOLVED and item_id_str in llm_verdicts:
                final_updates.append(ResolutionUpdate(
                    item_id=u.item_id,
                    category_id=u.category_id,
                    status=llm_verdicts[item_id_str],
                ))
            else:
                final_updates.append(u)

        # Structural items: use LLM verdict if available, otherwise still_unresolved.
        structural_updates = []
        for si in structural_items:
            status = llm_verdicts.get(si['id'], ResolutionStatus.STILL_UNRESOLVED)
            structural_updates.append((si['id'], new_draft_id, status.value if isinstance(status, ResolutionStatus) else status))

        rows_to_insert = [
            (u.item_id, new_draft_id, u.status.value)
            for u in final_updates
        ] + structural_updates

        if rows_to_insert:
            with conn.cursor() as cur:
                cur.executemany("""
                    INSERT INTO resolution_status_history (feedback_item_id, draft_id, status, evaluated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (feedback_item_id, draft_id) DO NOTHING
                """, rows_to_insert)
            conn.commit()
            judged = len(changed_items)
            logger.info(f"Wrote {len(rows_to_insert)} resolution_status_history rows "
                        f"({judged} LLM-judged, {len(rows_to_insert) - judged} structural) for draft {new_draft_id}")

    except Exception as e:
        logger.error(f"Error persisting resolution status: {str(e)}", exc_info=True)
        # Non-fatal: don't fail the whole feedback job over analytics tracking


def update_aggregate_counters(document_type_id: str, feedback_count: int, conn: psycopg.Connection) -> None:
    """Update aggregate counters for analytics."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO aggregate_counter (scope_kind, scope_id, metric, window_start, value)
                VALUES ('documentType', %s, 'feedback_items_generated', date_trunc('week', NOW()), %s)
                ON CONFLICT (scope_kind, scope_id, metric, window_start) DO UPDATE
                SET value = aggregate_counter.value + EXCLUDED.value
            """, (document_type_id, feedback_count))

        conn.commit()
    except Exception as e:
        logger.error(f"Error updating aggregate counters: {str(e)}")
        conn.rollback()


_SENTINEL_DATETIME = datetime(2000, 1, 1, tzinfo=timezone.utc)


def _persist_carried_forward_items(
    document_id: str,
    new_draft_id: str,
    segments: list[dict[str, Any]],
    prior_cached: list[CachedFeedbackItem],
    conn: psycopg.Connection,
) -> int:
    """Re-insert carried-forward feedback items under the new draft.

    Each carried item becomes a new feedback_item row (with source_draft_id =
    new_draft_id) plus a new anchor row so the debrief for this draft is
    self-contained (REQ-NFR-COST-01 criterion 1: "persist prior Feedback Items
    and reuse them").
    """
    count = 0
    with conn.cursor() as cur:
        for cached in prior_cached:
            try:
                item = cached.item
                kind = 'structural' if isinstance(item, StructuralFeedbackItem) else 'inline'
                category_id = item.category
                question_text = item.question

                quoted_text = None
                anchor_data = None
                if isinstance(item, ValidatedFeedbackItem) and item.anchor:
                    anchor_data = item.anchor
                    para_idx = anchor_data.get('paragraph', 0)
                    start_off = anchor_data.get('start', 0)
                    end_off = anchor_data.get('end', 0)
                    if para_idx < len(segments):
                        para_text = segments[para_idx].get('text', '')
                        if end_off > start_off and end_off <= len(para_text):
                            quoted_text = para_text[start_off:end_off]

                feedback_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO feedback_item
                    (id, document_id, error_category_id, kind, question_text, quoted_text, source_draft_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                """, (
                    feedback_id, document_id, category_id, kind,
                    question_text, quoted_text, new_draft_id,
                ))

                current_anchor_id = None
                if kind == 'inline' and anchor_data:
                    para_idx = anchor_data.get('paragraph', 0)
                    start_off = anchor_data.get('start', 0)
                    end_off = anchor_data.get('end', 0)
                    para_text = ''
                    if para_idx < len(segments):
                        para_text = segments[para_idx].get('text', '')
                    content_fp = compute_content_fingerprint(para_text, start_off, end_off)

                    anchor_id = str(uuid.uuid4())
                    cur.execute("""
                        INSERT INTO anchor
                        (id, feedback_item_id, draft_id, paragraph_index, start_offset, end_offset, content_fingerprint, state)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, 'active')
                    """, (
                        anchor_id, feedback_id, new_draft_id,
                        para_idx, start_off, end_off, content_fp,
                    ))
                    current_anchor_id = anchor_id

                if current_anchor_id:
                    cur.execute("""
                        UPDATE feedback_item SET current_anchor_id = %s WHERE id = %s
                    """, (current_anchor_id, feedback_id))

                count += 1
            except Exception as e:
                logger.warning(f"Failed to persist carried-forward item: {e}")
                continue

    conn.commit()
    return count


def _build_config_snapshot(
    config: dict[str, Any],
    doc_type_meta: dict[str, Any],
    department_prompt: str,
) -> ConfigSnapshot:
    """Build a ConfigSnapshot from loaded config for carry-forward comparison."""
    category_names = tuple(doc_type_meta.get('category_names', []))
    tone = config.get('tone', 'supportive')
    density = config.get('density', 'moderate')
    category_priority = tuple(str(c) for c in config.get('category_priority', []))

    type_instruction_parts = []
    if department_prompt.strip():
        type_instruction_parts.append(department_prompt.strip())
    base_instructions = config.get('type_prompt_text', '')
    if base_instructions:
        type_instruction_parts.append(base_instructions)
    for field_key in ('structure_description', 'restrictions_description', 'notes_description'):
        value = config.get(field_key) or ''
        if value.strip():
            type_instruction_parts.append(value.strip())
    type_instructions = '|'.join(type_instruction_parts)

    updated_at = config.get('updated_at') or _SENTINEL_DATETIME

    return ConfigSnapshot.from_config(
        category_names=category_names,
        tone=tone,
        density=density,
        category_priority=category_priority,
        type_instructions=type_instructions,
        updated_at=updated_at,
    )


def _load_prior_cached_items(
    document_id: str,
    current_draft_id: str,
    current_config_snapshot: ConfigSnapshot,
    conn: psycopg.Connection,
) -> tuple[list[CachedFeedbackItem], list[dict[str, Any]] | None]:
    """Load prior draft's feedback items reconstructed as CachedFeedbackItem objects.

    Returns (cached_items, prev_segments) or ([], None) if no prior draft exists.
    The config_hash on cached items is set to the current config's hash so that
    the CarryForwardCache._is_valid check passes (config-change detection is handled
    separately via the updated_at timestamp pre-check in the caller).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT d.id, d.segments
            FROM draft d
            WHERE d.document_id = %s
              AND d.id != %s
            ORDER BY d.created_at DESC
            LIMIT 1
        """, (document_id, current_draft_id))
        prev_row = cur.fetchone()
        if not prev_row:
            return [], None

        prev_draft_id, prev_segments_raw = prev_row
        prev_segments = json.loads(prev_segments_raw) if isinstance(prev_segments_raw, str) else prev_segments_raw

        cur.execute("""
            SELECT fi.id, fi.error_category_id, fi.kind, fi.question_text,
                   a.paragraph_index, a.start_offset, a.end_offset,
                   fi.created_at
            FROM feedback_item fi
            LEFT JOIN anchor a ON a.feedback_item_id = fi.id AND a.draft_id = %s
            WHERE fi.source_draft_id = %s
        """, (prev_draft_id, prev_draft_id))
        prior_rows = cur.fetchall()

    if not prior_rows:
        return [], prev_segments

    full_prior_text = '\n'.join(seg.get('text', '') for seg in prev_segments)
    prior_doc_hash = CarryForwardCache.compute_document_hash(full_prior_text)

    cached_items: list[CachedFeedbackItem] = []
    for row in prior_rows:
        item_id, category_id, kind, question_text = str(row[0]), str(row[1]), row[2], row[3]
        para_idx, start_off, end_off = row[4], row[5], row[6]
        created_at = row[7] or _SENTINEL_DATETIME

        if kind == 'structural' or para_idx is None:
            item = StructuralFeedbackItem(
                category=category_id,
                question=question_text or '',
            )
            cache_key = CacheKey(
                span_fingerprint=prior_doc_hash,
                config_hash=current_config_snapshot.config_hash,
                is_structural=True,
            )
        else:
            para_text = ''
            if para_idx < len(prev_segments):
                para_text = prev_segments[para_idx].get('text', '')
            fp = compute_anchor_fingerprint(para_text, 0, len(para_text))
            item = ValidatedFeedbackItem(
                category=category_id,
                question=question_text or '',
                anchor={'paragraph': para_idx, 'start': start_off or 0, 'end': end_off or 0},
                citation=None,
            )
            cache_key = CacheKey(
                span_fingerprint=fp.text_hash,
                config_hash=current_config_snapshot.config_hash,
                is_structural=False,
            )

        cached_items.append(CachedFeedbackItem(
            item=item,
            cache_key=cache_key,
            generated_at=created_at,
            config_snapshot=current_config_snapshot,
        ))

    return cached_items, prev_segments


def _compute_current_fingerprints(segments: list[dict[str, Any]]) -> dict[int, str]:
    """Compute per-paragraph fingerprints for carry-forward comparison."""
    fingerprints: dict[int, str] = {}
    for i, seg in enumerate(segments):
        text = seg.get('text', '')
        if text.strip():
            fp = compute_anchor_fingerprint(text, 0, len(text))
            fingerprints[i] = fp.text_hash
    return fingerprints


def _remap_carried_forward_indices(
    carried_forward: tuple[CachedFeedbackItem, ...],
    current_fingerprints: dict[int, str],
) -> list[CachedFeedbackItem]:
    """Remap carried-forward items' paragraph indices to their current positions.

    The CarryForwardCache validates items by fingerprint VALUE, not by index.
    If a paragraph moved (e.g., new paragraph inserted above), the item's
    anchor still carries the OLD index. This function builds a reverse lookup
    (fingerprint → current index) and updates each item's anchor accordingly.
    Items whose fingerprint appears at multiple indices (ambiguous) are dropped.
    """
    fp_to_idx: dict[str, list[int]] = {}
    for idx, fp in current_fingerprints.items():
        fp_to_idx.setdefault(fp, []).append(idx)

    remapped: list[CachedFeedbackItem] = []
    for cached in carried_forward:
        if cached.cache_key.is_structural:
            remapped.append(cached)
            continue

        span_fp = cached.cache_key.span_fingerprint
        indices = fp_to_idx.get(span_fp, [])

        if len(indices) == 1:
            new_idx = indices[0]
            if isinstance(cached.item, ValidatedFeedbackItem) and cached.item.anchor:
                old_anchor = cached.item.anchor
                if old_anchor.get('paragraph') != new_idx:
                    updated_item = ValidatedFeedbackItem(
                        category=cached.item.category,
                        question=cached.item.question,
                        anchor={**old_anchor, 'paragraph': new_idx},
                        citation=cached.item.citation,
                    )
                    cached = CachedFeedbackItem(
                        item=updated_item,
                        cache_key=cached.cache_key,
                        generated_at=cached.generated_at,
                        config_snapshot=cached.config_snapshot,
                    )
            remapped.append(cached)
        elif len(indices) == 0:
            continue
        else:
            # Ambiguous — same text at multiple indices; skip to avoid mis-attachment
            continue

    return remapped


def process_feedback_request(
    job_id: str,
    document_id: str,
    draft_id: str,
    user_id: str,
    writing_type_id: str
) -> None:
    """Process a single feedback request."""
    conn = None
    try:
        # Step 1: Get database connection
        conn = get_db_connection()

        # Step 2: Load prompt config (includes category_priority filter)
        logger.info("Loading prompt config...")
        config = load_prompt_config(writing_type_id, conn)  # writing_type_id == document_type_id

        # Step 2b: Load document type name + error category taxonomy
        logger.info("Loading document type meta...")
        doc_type_meta = load_document_type_meta(writing_type_id, conn)

        # Step 2c: Load department-level prompt
        logger.info("Loading department prompt...")
        department_prompt = load_department_prompt(writing_type_id, conn)

        # Step 3: Load draft segments
        logger.info("Loading draft segments...")
        segments = load_draft_segments(draft_id, conn)

        if not segments:
            logger.warning(f"No segments found for draft {draft_id}")
            return

        # ─── Carry-forward evaluation (guard gate) ───────────────────────────
        focus_paragraph_indices: set[int] | None = None

        try:
            config_snapshot = _build_config_snapshot(config, doc_type_meta, department_prompt)
            prior_cached, _prev_segs = _load_prior_cached_items(
                document_id, draft_id, config_snapshot, conn,
            )

            if prior_cached:
                config_updated_at = config.get('updated_at')
                max_generated_at = max(item.generated_at for item in prior_cached)

                if config_updated_at and config_updated_at > max_generated_at:
                    logger.info("Carry-forward: config updated since prior generation, full regeneration")
                else:
                    current_fps = _compute_current_fingerprints(segments)
                    doc_hash = CarryForwardCache.compute_document_hash(
                        '\n'.join(seg.get('text', '') for seg in segments)
                    )
                    decision = CarryForwardCache().evaluate(
                        prior_items=prior_cached,
                        current_span_fingerprints=current_fps,
                        current_config=config_snapshot,
                        current_doc_hash=doc_hash,
                    )

                    if not decision.invalidated and not decision.new_span_indices:
                        remapped = _remap_carried_forward_indices(
                            decision.carried_forward, current_fps,
                        )
                        logger.info(
                            f"Carry-forward: all {len(remapped)} items reused, "
                            f"skipping Bedrock for job {job_id}"
                        )
                        cf_count = _persist_carried_forward_items(
                            document_id, draft_id, segments, remapped, conn,
                        )
                        logger.info(f"Persisted {cf_count} carried-forward items for draft {draft_id}")
                        persist_resolution_status(document_id, draft_id, segments, config, conn)
                        return

                    if decision.carried_forward:
                        remapped = _remap_carried_forward_indices(
                            decision.carried_forward, current_fps,
                        )

                        if any(item.cache_key.is_structural for item in decision.invalidated):
                            focus_paragraph_indices = None
                        else:
                            # Determine which current indices are covered by carried-forward
                            covered_current_indices: set[int] = set()
                            for item in remapped:
                                if not item.cache_key.is_structural and isinstance(item.item, ValidatedFeedbackItem) and item.item.anchor:
                                    covered_current_indices.add(item.item.anchor.get('paragraph', -1))
                            # Focus = all current indices NOT covered by carried-forward items
                            all_current_indices = set(current_fps.keys())
                            focus_paragraph_indices = all_current_indices - covered_current_indices

                        cf_count = _persist_carried_forward_items(
                            document_id, draft_id, segments, remapped, conn,
                        )
                        logger.info(
                            f"Carry-forward: {len(remapped)} reused "
                            f"({cf_count} persisted), "
                            f"{len(decision.invalidated)} invalidated, "
                            f"focus on {len(focus_paragraph_indices) if focus_paragraph_indices else 'all'} paragraphs"
                        )
        except Exception as cf_err:
            logger.warning(f"Carry-forward evaluation failed, full generation: {cf_err}", exc_info=True)
            focus_paragraph_indices = None
        # ─── End carry-forward evaluation ─────────────────────────────────────

        # Step 4: Load reference material
        logger.info("Loading reference material...")
        reference_materials = load_reference_material(writing_type_id)

        # Step 5: Assemble prompt using the layered PromptAssembler
        logger.info("Assembling prompt...")
        prompt = assemble_prompt(
            config, doc_type_meta, department_prompt, segments, reference_materials,
            focus_paragraph_indices=focus_paragraph_indices,
        )

        # Step 6: Invoke Bedrock
        logger.info("Invoking Bedrock...")
        model_output = invoke_bedrock(prompt, config)
        logger.info(f"Bedrock output received ({len(model_output)} chars)")

        # Step 7: Parse feedback output
        logger.info("Parsing feedback output...")
        feedback_items = parse_feedback_output(model_output)
        logger.info(f"Parsed {len(feedback_items)} feedback items")

        if not feedback_items:
            logger.warning("No feedback items parsed from model output")
            persist_resolution_status(document_id, draft_id, segments, config, conn)
            return

        # Step 7b: Filter feedback items by category_priority (dept admin selection)
        category_priority = config.get('category_priority', [])
        if category_priority:
            original_count = len(feedback_items)
            feedback_items = [
                item for item in feedback_items
                if item.get('error_category_id') in category_priority
            ]
            filtered_count = original_count - len(feedback_items)
            if filtered_count > 0:
                logger.info(f"Filtered {filtered_count} feedback items outside dept admin selection (kept {len(feedback_items)})")

        # Step 8: Insert into database and update counters
        logger.info("Inserting feedback items...")
        item_count = insert_feedback_items(document_id, draft_id, user_id, feedback_items, segments, conn)

        logger.info("Updating aggregate counters...")
        update_aggregate_counters(writing_type_id, item_count, conn)

        # Step 9: Compute and persist resolution status for prior feedback items
        logger.info("Persisting resolution status history...")
        persist_resolution_status(document_id, draft_id, segments, config, conn)

        logger.info(f"Feedback job {job_id} completed: {item_count} items inserted")

    except Exception as e:
        logger.error(f"Error processing feedback request {job_id}: {str(e)}", exc_info=True)
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    AWS Lambda handler for feedback generation.
    Receives SQS events from the feedback queue and processes them.

    Each SQS record contains:
      {
        "jobId": "doc-123-456",
        "documentId": "doc-123",
        "draftId": "draft-456",
        "userId": "user-789",
        "writingTypeId": "wtype-111"
      }
    """
    try:
        records = event.get('Records', [])
        logger.info(f"Received {len(records)} feedback jobs")

        success_count = 0
        failure_count = 0

        # Process each SQS record
        for record in records:
            try:
                # Parse SQS message body
                body = json.loads(record['body'])
                job_id = body['jobId']
                document_id = body['documentId']
                draft_id = body['draftId']
                user_id = body['userId']
                writing_type_id = body['writingTypeId']

                logger.info(f"Processing feedback job {job_id} for document {document_id}")

                # Process the feedback request
                process_feedback_request(job_id, document_id, draft_id, user_id, writing_type_id)

                success_count += 1

            except Exception as job_error:
                logger.error(f"Error processing job: {str(job_error)}", exc_info=True)
                failure_count += 1
                # SQS will handle the failure and retry or send to DLQ

        logger.info(f"Feedback batch completed: {success_count} succeeded, {failure_count} failed")

        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Feedback jobs processed",
                "success_count": success_count,
                "failure_count": failure_count
            }),
        }

    except Exception as e:
        logger.error(f"Error processing feedback batch: {str(e)}", exc_info=True)
        raise
