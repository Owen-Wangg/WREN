"""
Feedback Engine Lambda handler — processes feedback generation jobs from SQS.
Receives SQS events, extracts job details, invokes the feedback generation,
and persists results to the database.
"""

import json
import logging
import os
from typing import Any
import uuid
import hashlib

import psycopg3
import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def get_db_connection():
    """Get database connection from Secrets Manager."""
    try:
        secrets_client = boto3.client('secretsmanager', region_name=os.getenv('AWS_REGION', 'ca-central-1'))
        secret_arn = os.getenv('DB_SECRET_ARN')

        secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
        secret = json.loads(secret_response['SecretString'])

        conn = psycopg3.connect(
            host=secret['host'],
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


def load_prompt_config(writing_type_id: str, conn: psycopg3.Connection) -> dict[str, Any]:
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
                    COALESCE(category_priority, '[]'::jsonb)
                FROM writing_type_config
                WHERE writing_type_id = %s
            """, (writing_type_id,))

            result = cur.fetchone()
            if result:
                return {
                    'type_prompt_text': result[0],
                    'tone': result[1],
                    'density': result[2],
                    'tone_description': result[3],
                    'density_description': result[4],
                    'category_priority': json.loads(result[5]) if isinstance(result[5], str) else result[5],
                    'temperature': 0.7,
                }

            # Return default config if not found
            return {
                'type_prompt_text': 'You are WREN, a Socratic writing coach. Your role is to guide writers toward excellence through thoughtful questions rather than direct answers.',
                'tone': 'supportive',
                'density': 'moderate',
                'tone_description': 'Be supportive and encouraging while maintaining high expectations.',
                'density_description': 'Provide feedback across multiple dimensions of writing quality, focusing on the most impactful improvements.',
                'category_priority': [],
                'temperature': 0.7,
            }
    except Exception as e:
        logger.error(f"Error loading prompt config: {str(e)}")
        raise


def load_draft_segments(draft_id: str, conn: psycopg3.Connection) -> list[dict[str, Any]]:
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
    segments: list[dict[str, Any]],
    reference_materials: list[dict[str, Any]]
) -> str:
    """Assemble the full prompt for Bedrock."""
    doc_text = '\n'.join([seg.get('text', '') for seg in segments if 'text' in seg])
    ref_text = '\n'.join([f"## {m['title']}\n{m['content']}" for m in reference_materials])

    system_scaffold = config.get('type_prompt_text', 'You are WREN, a Socratic writing coach.')
    tone_guidance = config.get('tone_description', '')
    density_guidance = config.get('density_description', '')

    prompt = f"""{system_scaffold}

## Tone Guidance
{tone_guidance}

## Feedback Density
{density_guidance}

## Reference Materials
{ref_text if ref_text else '(No reference materials)'}

## Document to Review
{doc_text}

## Output Format
Provide feedback as a JSON array of objects with the following structure:
[
  {{
    "error_category_id": "string",
    "kind": "inline" | "structural",
    "question_text": "string",
    "quoted_text": "string (optional, for inline feedback)",
    "anchor": {{
      "startOffset": 0,
      "endOffset": 42,
      "paragraphIndex": 0
    }}
  }}
]

CRITICAL: Only output valid JSON. No additional text. Never provide replacement prose or rewriting suggestions."""

    return prompt


def invoke_bedrock(prompt: str, config: dict[str, Any]) -> str:
    """Invoke Bedrock Claude model."""
    try:
        bedrock_client = boto3.client('bedrock-runtime', region_name=os.getenv('AWS_REGION', 'ca-central-1'))
        model_id = os.getenv('BEDROCK_MODEL_ID', 'anthropic.claude-3-5-sonnet-20241022-v2:0')

        response = bedrock_client.invoke_model(
            modelId=model_id,
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-06-01',
                'max_tokens': 4096,
                'messages': [
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ],
                'temperature': float(config.get('temperature', 0.7)),
            })
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
        logger.error(f"Failed to parse feedback JSON: {str(e)}")
        return []
    except Exception as e:
        logger.error(f"Error parsing feedback output: {str(e)}")
        return []


def compute_content_fingerprint(text: str, start_offset: int, end_offset: int) -> str:
    """Compute fingerprint of anchor content."""
    anchor_text = text[start_offset:end_offset]
    return hashlib.sha256(anchor_text.encode()).hexdigest()[:16]


def insert_feedback_items(
    document_id: str,
    draft_id: str,
    user_id: str,
    feedback_items: list[dict[str, Any]],
    segments: list[dict[str, Any]],
    conn: psycopg3.Connection
) -> int:
    """Insert feedback items and anchors into database."""
    try:
        item_count = 0
        with conn.cursor() as cur:
            for item in feedback_items:
                try:
                    # Insert feedback item
                    feedback_id = str(uuid.uuid4())
                    cur.execute("""
                        INSERT INTO feedback_item
                        (id, document_id, error_category_id, kind, question_text, source_draft_id, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    """, (
                        feedback_id,
                        document_id,
                        item.get('error_category_id', 'unknown'),
                        item.get('kind', 'inline'),
                        item.get('question_text', ''),
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


def update_aggregate_counters(document_type_id: str, feedback_count: int, conn: psycopg3.Connection) -> None:
    """Update aggregate counters for analytics."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO aggregate_counter (document_type_id, metric_type, count, week_of)
                VALUES (%s, 'feedback_items_generated', %s, date_trunc('week', NOW()))
                ON CONFLICT (document_type_id, metric_type, week_of) DO UPDATE
                SET count = aggregate_counter.count + EXCLUDED.count
            """, (document_type_id, feedback_count))

        conn.commit()
    except Exception as e:
        logger.error(f"Error updating aggregate counters: {str(e)}")
        conn.rollback()


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
        config = load_prompt_config(writing_type_id, conn)

        # Step 3: Load draft segments
        logger.info("Loading draft segments...")
        segments = load_draft_segments(draft_id, conn)

        if not segments:
            logger.warning(f"No segments found for draft {draft_id}")
            return

        # Step 4: Load reference material
        logger.info("Loading reference material...")
        reference_materials = load_reference_material(writing_type_id)

        # Step 5: Assemble prompt
        logger.info("Assembling prompt...")
        prompt = assemble_prompt(config, segments, reference_materials)

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
