"""Tests for marker parsing, stripping, and buffering logic in main.py.

Simulates the streaming chunk scenario where markers arrive split across
multiple Gemini response chunks, which was the root cause of the
'AI goes silent after [STEPS_START][STEP 1]' bug.
"""
import asyncio
import json
import pytest
import sys
import os

# Allow importing main without GOOGLE_API_KEY by mocking
os.environ.setdefault("GOOGLE_API_KEY", "fake-key-for-tests")

# Mock the google.genai and api_helpers modules before importing main
from unittest.mock import MagicMock, AsyncMock
sys.modules["google"] = MagicMock()
sys.modules["google.genai"] = MagicMock()
sys.modules["google.genai.types"] = MagicMock()
sys.modules["api_helpers"] = MagicMock()

import main
from main import (
    RE_STEPS, RE_STEP_LINE, RE_STEP_STATUS, RE_PART_ID, RE_REPAIR_TOPIC,
    RE_ALL_MARKERS, RE_MARKER_OPEN, RE_MARKER_COMPLETE,
    _might_contain_marker, _has_complete_markers, _get_incomplete_marker_tail,
    parse_and_strip_markers,
)


# ---- Regex unit tests ----

class TestRegexMatching:
    """Verify regexes match the marker formats Gemini actually produces."""

    def test_steps_block_uppercase(self):
        text = "[STEPS_START] total=3\n[STEP 1] Turn off power\n[STEP 2] Remove cover\n[STEP 3] Replace part\n[STEPS_END]"
        m = RE_STEPS.search(text)
        assert m is not None
        assert m.group(1) == "3"

    def test_steps_block_extracts_steps(self):
        text = "[STEPS_START] total=2\n[STEP 1] Do first thing\n[STEP 2] Do second thing\n[STEPS_END]"
        m = RE_STEPS.search(text)
        body = m.group(2)
        steps = list(RE_STEP_LINE.finditer(body))
        assert len(steps) == 2
        assert steps[0].group(1) == "1"
        assert steps[0].group(2).strip() == "Do first thing"
        assert steps[1].group(1) == "2"
        assert steps[1].group(2).strip() == "Do second thing"

    def test_step_status(self):
        text = '[STEP_STATUS] current=1 status="completed" message="Great job!" [/STEP_STATUS]'
        m = RE_STEP_STATUS.search(text)
        assert m is not None
        assert m.group(1) == "1"
        assert m.group(2) == "completed"
        assert m.group(3) == "Great job!"

    def test_part_id(self):
        text = '[PART_ID] name="Thermal Fuse" model="WP3392519" query="Whirlpool thermal fuse WP3392519" [/PART_ID]'
        m = RE_PART_ID.search(text)
        assert m is not None
        assert m.group(1) == "Thermal Fuse"
        assert m.group(2) == "WP3392519"

    def test_repair_topic(self):
        text = '[REPAIR_TOPIC] query="dryer not heating" category="appliance" [/REPAIR_TOPIC]'
        m = RE_REPAIR_TOPIC.search(text)
        assert m is not None
        assert m.group(1) == "dryer not heating"
        assert m.group(2) == "appliance"

    def test_case_insensitive_matching(self):
        """Gemini might output markers in any case via transcription."""
        text = "[steps_start] total=2\n[step 1] Do X\n[step 2] Do Y\n[steps_end]"
        m = RE_STEPS.search(text)
        assert m is not None
        assert m.group(1) == "2"


class TestMarkerStripping:
    """Verify RE_ALL_MARKERS strips complete and partial markers."""

    def test_strips_complete_steps_block(self):
        text = "Hello [STEPS_START] total=2\n[STEP 1] A\n[STEP 2] B\n[STEPS_END] goodbye"
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert cleaned == "Hello  goodbye"

    def test_strips_step_status(self):
        text = 'Nice work [STEP_STATUS] current=1 status="completed" message="Done" [/STEP_STATUS] keep going'
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert cleaned == "Nice work  keep going"

    def test_strips_part_id(self):
        text = 'You need [PART_ID] name="Fuse" model="123" query="fuse 123" [/PART_ID] to fix this'
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert cleaned == "You need  to fix this"

    def test_strips_repair_topic(self):
        text = 'This is [REPAIR_TOPIC] query="broken faucet" category="plumbing" [/REPAIR_TOPIC] a faucet'
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert cleaned == "This is  a faucet"

    def test_strips_orphaned_steps_start(self):
        """Partial marker from incomplete streaming chunk."""
        text = "I see the problem. [STEPS_START] total=3"
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert cleaned == "I see the problem."

    def test_strips_orphaned_step_line(self):
        text = "[STEP 1] Turn off the breaker"
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert cleaned == ""

    def test_strips_orphaned_steps_end(self):
        text = "And that's it [STEPS_END]"
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert cleaned == "And that's it"

    def test_strips_orphaned_closing_tags(self):
        for tag in ["[/STEP_STATUS]", "[/PART_ID]", "[/REPAIR_TOPIC]"]:
            text = f"text before {tag} text after"
            cleaned = RE_ALL_MARKERS.sub('', text).strip()
            assert "text before" in cleaned
            assert "text after" in cleaned
            assert tag not in cleaned

    def test_strips_all_markers_from_complex_response(self):
        """Simulates a full response with multiple marker types."""
        text = (
            "I can see your dryer. "
            '[REPAIR_TOPIC] query="dryer not heating" category="appliance" [/REPAIR_TOPIC] '
            "Let me walk you through this. "
            "[STEPS_START] total=3\n"
            "[STEP 1] Unplug the dryer\n"
            "[STEP 2] Remove the back panel\n"
            "[STEP 3] Test the thermal fuse\n"
            "[STEPS_END] "
            "Start by unplugging it."
        )
        cleaned = RE_ALL_MARKERS.sub('', text).strip()
        assert "[" not in cleaned
        assert "I can see your dryer" in cleaned
        assert "Start by unplugging it" in cleaned


# ---- Buffer helper tests ----

class TestBufferHelpers:
    """Test the buffering helpers that decide when to flush vs accumulate."""

    def test_might_contain_marker_true(self):
        assert _might_contain_marker("[STEPS_START] total=3") is True
        assert _might_contain_marker("hello [STEP 1] do this") is True
        assert _might_contain_marker("[PART_ID] name=") is True
        assert _might_contain_marker("[REPAIR_TOPIC] query=") is True
        assert _might_contain_marker("[STEP_STATUS] current=1") is True

    def test_might_contain_marker_false(self):
        assert _might_contain_marker("just normal text") is False
        assert _might_contain_marker("no markers here at all") is False
        assert _might_contain_marker("") is False

    def test_has_complete_markers_true(self):
        assert _has_complete_markers(
            "[STEPS_START] total=1\n[STEP 1] Do X\n[STEPS_END]"
        ) is True
        assert _has_complete_markers(
            '[PART_ID] name="X" model="" query="X" [/PART_ID]'
        ) is True

    def test_has_complete_markers_false(self):
        assert _has_complete_markers("[STEPS_START] total=1\n[STEP 1] Do X") is False
        assert _has_complete_markers("[PART_ID] name=") is False
        assert _has_complete_markers("no markers") is False

    def test_get_incomplete_marker_tail_none(self):
        """No incomplete marker at the end."""
        text = "Hello [STEPS_START] total=1\n[STEP 1] X\n[STEPS_END] bye"
        assert _get_incomplete_marker_tail(text) == ""

    def test_get_incomplete_marker_tail_with_trailing(self):
        """Incomplete marker at the end after a complete one."""
        text = '[PART_ID] name="X" model="" query="X" [/PART_ID] Now [STEP_STATUS] current=1'
        tail = _get_incomplete_marker_tail(text)
        assert "[STEP_STATUS]" in tail

    def test_get_incomplete_marker_tail_only_incomplete(self):
        """Only an incomplete marker, no complete ones."""
        text = "I see the problem [STEPS_START] total=3"
        tail = _get_incomplete_marker_tail(text)
        assert "[STEPS_START]" in tail


# ---- Streaming chunk simulation tests ----

class TestStreamingChunks:
    """Simulate the exact scenario that caused the original bug:
    markers arriving split across multiple streaming chunks."""

    def test_chunked_steps_scenario(self):
        """The original bug: [STEPS_START] and [STEPS_END] in different chunks."""
        chunk1 = "I see a broken faucet. [STEPS_START] total=3\n[STEP 1] Turn off water"
        chunk2 = "\n[STEP 2] Remove handle\n[STEP 3] Replace cartridge\n[STEPS_END]"

        # After chunk1: buffer should hold (has marker open, no complete marker)
        buf = chunk1
        assert _might_contain_marker(buf) is True
        assert _has_complete_markers(buf) is False
        # So we accumulate, don't send

        # After chunk2 arrives:
        buf += chunk2
        assert _has_complete_markers(buf) is True
        # Now we process — markers get stripped
        cleaned = RE_ALL_MARKERS.sub('', buf).strip()
        assert "[" not in cleaned
        assert "I see a broken faucet." in cleaned

    def test_chunked_part_id(self):
        """Part ID marker split across chunks."""
        chunk1 = 'You need a [PART_ID] name="Thermal Fuse"'
        chunk2 = ' model="WP3392519" query="thermal fuse" [/PART_ID] for this repair.'

        buf = chunk1
        assert _might_contain_marker(buf) is True
        assert _has_complete_markers(buf) is False

        buf += chunk2
        assert _has_complete_markers(buf) is True
        cleaned = RE_ALL_MARKERS.sub('', buf).strip()
        assert "You need a" in cleaned
        assert "for this repair" in cleaned
        assert "[PART_ID]" not in cleaned

    def test_plain_text_no_delay(self):
        """Plain text without markers should be identified for immediate send."""
        text = "I can see a leaky faucet. Let me help you fix that."
        assert _might_contain_marker(text) is False
        # This means the buffer logic sends immediately

    def test_text_before_and_after_markers(self):
        """Text surrounding markers should survive stripping."""
        full = (
            "Okay I see the issue. "
            "[STEPS_START] total=2\n[STEP 1] Do X\n[STEP 2] Do Y\n[STEPS_END] "
            "Let's start with step one."
        )
        cleaned = RE_ALL_MARKERS.sub('', full).strip()
        assert "Okay I see the issue." in cleaned
        assert "Let's start with step one." in cleaned
        assert "[" not in cleaned

    def test_multiple_marker_types_in_one_response(self):
        """Response with both REPAIR_TOPIC and STEPS markers."""
        full = (
            '[REPAIR_TOPIC] query="fix leaky faucet" category="plumbing" [/REPAIR_TOPIC] '
            "I see a leaky faucet. "
            "[STEPS_START] total=2\n[STEP 1] Turn off\n[STEP 2] Replace washer\n[STEPS_END] "
            "First, turn off the water."
        )
        assert _has_complete_markers(full) is True
        cleaned = RE_ALL_MARKERS.sub('', full).strip()
        assert "I see a leaky faucet" in cleaned
        assert "First, turn off the water" in cleaned
        assert "[" not in cleaned


# ---- parse_and_strip_markers async tests ----

class FakeWebSocket:
    """Mock websocket that records sent messages."""
    def __init__(self):
        self.messages = []

    async def send_json(self, data):
        self.messages.append(data)


@pytest.mark.asyncio
class TestParseAndStripMarkers:
    """Test the full parse_and_strip_markers function."""

    async def test_parses_steps_and_sends_update(self):
        ws = FakeWebSocket()
        step_state = {"steps": [], "current_step": 0, "total_steps": 0}
        text = "[STEPS_START] total=2\n[STEP 1] Turn off water\n[STEP 2] Fix pipe\n[STEPS_END]"

        cleaned = await parse_and_strip_markers(text, step_state, set(), ws)

        assert cleaned == ""
        assert len(ws.messages) == 1
        msg = ws.messages[0]
        assert msg["type"] == "step_update"
        assert msg["total_steps"] == 2
        assert len(msg["steps"]) == 2
        assert msg["steps"][0]["text"] == "Turn off water"
        assert msg["steps"][0]["status"] == "active"
        assert msg["steps"][1]["status"] == "pending"

    async def test_parses_step_status(self):
        ws = FakeWebSocket()
        step_state = {
            "steps": [
                {"number": 1, "text": "X", "status": "active"},
                {"number": 2, "text": "Y", "status": "pending"},
            ],
            "current_step": 1,
            "total_steps": 2,
        }
        text = '[STEP_STATUS] current=1 status="completed" message="Nice!" [/STEP_STATUS]'

        cleaned = await parse_and_strip_markers(text, step_state, set(), ws)

        assert cleaned == ""
        assert step_state["steps"][0]["status"] == "completed"
        assert step_state["steps"][1]["status"] == "active"
        assert step_state["current_step"] == 2

    async def test_returns_cleaned_text_with_markers_stripped(self):
        ws = FakeWebSocket()
        text = (
            "I see a broken pipe. "
            '[REPAIR_TOPIC] query="broken pipe" category="plumbing" [/REPAIR_TOPIC] '
            "Let me help."
        )

        cleaned = await parse_and_strip_markers(text, {}, set(), ws)

        assert "I see a broken pipe" in cleaned
        assert "Let me help" in cleaned
        assert "[" not in cleaned

    async def test_deduplicates_repair_topic(self):
        ws = FakeWebSocket()
        searched = set()
        text = '[REPAIR_TOPIC] query="broken pipe" category="plumbing" [/REPAIR_TOPIC]'

        await parse_and_strip_markers(text, {}, searched, ws)
        assert "broken pipe" in searched

        # Second call with same topic should not create another task
        ws2 = FakeWebSocket()
        await parse_and_strip_markers(text, {}, searched, ws2)
        # No additional messages (the asyncio.create_task is fire-and-forget,
        # but searched set prevents duplicate)

    async def test_text_with_no_markers_passes_through(self):
        ws = FakeWebSocket()
        text = "Just a normal response about your faucet."
        cleaned = await parse_and_strip_markers(text, {}, set(), ws)
        assert cleaned == text

    async def test_safety_alert_not_stripped(self):
        ws = FakeWebSocket()
        text = "[SAFETY_ALERT] Warning: exposed wires detected!"
        cleaned = await parse_and_strip_markers(text, {}, set(), ws)
        assert cleaned == text  # safety alert is NOT a marker, handled by caller


# ---- Full buffer flow simulation ----

@pytest.mark.asyncio
class TestBufferFlowSimulation:
    """End-to-end simulation of the send_to_client buffer logic."""

    async def _simulate_buffer_flow(self, chunks: list[str]) -> tuple[list[dict], dict]:
        """Simulate the buffer accumulation logic from send_to_client.
        Returns (sent_messages, final_step_state)."""
        ws = FakeWebSocket()
        step_state = {"steps": [], "current_step": 0, "total_steps": 0}
        searched_topics = set()
        transcript_buf = ""

        for i, chunk in enumerate(chunks):
            is_last = (i == len(chunks) - 1)
            transcript_buf += chunk

            # Simulate turn_complete on last chunk
            turn_complete = is_last

            if transcript_buf and (turn_complete or _has_complete_markers(transcript_buf)):
                cleaned = await parse_and_strip_markers(
                    transcript_buf, step_state, searched_topics, ws
                )
                leftover = _get_incomplete_marker_tail(transcript_buf)
                transcript_buf = leftover

                if cleaned:
                    if cleaned.upper().startswith("[SAFETY_ALERT]"):
                        ws.messages.append({"type": "safety_alert", "message": cleaned[len("[SAFETY_ALERT]"):].strip()})
                    else:
                        ws.messages.append({"type": "transcript", "text": cleaned})

            elif transcript_buf and not _might_contain_marker(transcript_buf):
                cleaned = transcript_buf.strip()
                transcript_buf = ""
                if cleaned:
                    ws.messages.append({"type": "transcript", "text": cleaned})

        # Final flush
        if transcript_buf.strip():
            cleaned = RE_ALL_MARKERS.sub('', transcript_buf).strip()
            if cleaned:
                ws.messages.append({"type": "transcript", "text": cleaned})

        return ws.messages, step_state

    async def test_original_bug_scenario(self):
        """THE bug: steps marker split across chunks causes silence."""
        chunks = [
            "I see a broken faucet. ",
            "[STEPS_START] total=3\n[STEP 1] Turn off water supply",
            "\n[STEP 2] Remove the handle",
            "\n[STEP 3] Replace the cartridge\n[STEPS_END]",
            " Start by turning off the water under the sink.",
        ]
        messages, step_state = await self._simulate_buffer_flow(chunks)

        # Should have: transcript for initial text, step_update, transcript for final text
        transcripts = [m for m in messages if m["type"] == "transcript"]
        step_updates = [m for m in messages if m["type"] == "step_update"]

        assert len(step_updates) >= 1, f"Expected step_update, got: {messages}"
        assert step_updates[0]["total_steps"] == 3
        assert len(step_updates[0]["steps"]) == 3

        # The user should see text (not raw markers)
        all_text = " ".join(m["text"] for m in transcripts)
        assert "[STEPS_START]" not in all_text
        assert "[STEP " not in all_text
        assert "[STEPS_END]" not in all_text

    async def test_plain_text_sent_immediately(self):
        """Plain text without markers should not be delayed."""
        chunks = [
            "I can see your appliance. ",
            "It looks like the motor is damaged.",
        ]
        messages, _ = await self._simulate_buffer_flow(chunks)
        transcripts = [m for m in messages if m["type"] == "transcript"]
        assert len(transcripts) >= 1
        all_text = " ".join(m["text"] for m in transcripts)
        assert "motor is damaged" in all_text

    async def test_marker_in_single_chunk(self):
        """Marker that arrives in one chunk (no splitting)."""
        chunks = [
            "Here's what to do. [STEPS_START] total=2\n[STEP 1] Do A\n[STEP 2] Do B\n[STEPS_END] Let's begin.",
        ]
        messages, step_state = await self._simulate_buffer_flow(chunks)
        step_updates = [m for m in messages if m["type"] == "step_update"]
        assert len(step_updates) == 1
        assert step_updates[0]["total_steps"] == 2

        transcripts = [m for m in messages if m["type"] == "transcript"]
        all_text = " ".join(m["text"] for m in transcripts)
        assert "[" not in all_text

    async def test_safety_alert_passes_through(self):
        """Safety alerts should be detected by the buffer logic."""
        chunks = [
            "[SAFETY_ALERT] I see exposed wires! Do not touch them.",
        ]
        messages, _ = await self._simulate_buffer_flow(chunks)
        safety = [m for m in messages if m["type"] == "safety_alert"]
        assert len(safety) == 1
        assert "exposed wires" in safety[0]["message"]

    async def test_multiple_marker_types_across_chunks(self):
        """REPAIR_TOPIC and STEPS in different chunks."""
        chunks = [
            'I see a dryer. [REPAIR_TOPIC] query="dryer not heating" category="appliance" [/REPAIR_TOPIC]',
            " Let me walk you through fixing this. [STEPS_START] total=2\n[STEP 1] Unplug",
            "\n[STEP 2] Test fuse\n[STEPS_END] Start by unplugging.",
        ]
        messages, step_state = await self._simulate_buffer_flow(chunks)

        step_updates = [m for m in messages if m["type"] == "step_update"]
        assert len(step_updates) >= 1

        transcripts = [m for m in messages if m["type"] == "transcript"]
        all_text = " ".join(m["text"] for m in transcripts)
        assert "[" not in all_text
        assert "dryer" in all_text.lower() or "unplug" in all_text.lower()
