from wren_engine.feedback_job_result import (
    TruncatedFeedbackError,
    coerce_draft_segments,
    require_complete_feedback_output,
)


def test_complete_output_with_items_is_ok() -> None:
    require_complete_feedback_output("end_turn", 4)


def test_max_tokens_is_non_retryable() -> None:
    try:
        require_complete_feedback_output("max_tokens", 12)
        raise AssertionError("expected TruncatedFeedbackError")
    except TruncatedFeedbackError:
        pass


def test_empty_parse_is_retryable() -> None:
    try:
        require_complete_feedback_output("end_turn", 0)
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "No feedback items" in str(exc)
        assert not isinstance(exc, TruncatedFeedbackError)


def test_coerce_draft_segments_accepts_list_or_json_string() -> None:
    rows = [{"index": 0, "text": "Hello"}]
    assert coerce_draft_segments(rows) == rows
    assert coerce_draft_segments('[{"index": 0, "text": "Hello"}]') == rows
    assert coerce_draft_segments(None) == []
