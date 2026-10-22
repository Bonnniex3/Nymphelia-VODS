import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from chat_auto import record_collisions, split_ambiguous_targets

ITEM = "NYMPHELIA-2026-ASMR-2"


def row(vod, name, item=ITEM):
    return dict(twitchVodId=vod, videoFile=name, iaItem=item, offsetSeconds=0)


class CollisionTests(unittest.TestCase):
    def test_both_colliding_vods_quarantined_other_entries_continue(self):
        first, second, good = row("1", "same.mp4"), row("2", "same.mp4"), row("3", "other.mp4")
        safe, blocked = split_ambiguous_targets([first, second, good])
        self.assertEqual(safe, [good])
        self.assertEqual(blocked, [first, second])
        other = row("4", "same.mp4", "NYMPHELIA-2026-ASMR")
        self.assertEqual(split_ambiguous_targets([first, other]), ([first, other], []))

    def test_a_stored_mapping_counts_as_one_side_of_the_collision(self):
        stored, derived_same, derived_other = row("1", "same.mp4"), row("2", "same.mp4"), row("3", "other.mp4")
        safe, blocked = split_ambiguous_targets([derived_same, derived_other], mapped=[stored])
        self.assertEqual((safe, blocked), ([derived_other], [derived_same]))

    def test_a_persisted_record_blocks_a_lone_derived_vod(self):
        record = {"iaItem": ITEM, "stem": "same", "twitchVodIds": ["1", "2"]}
        lone = row("2", "same.mp4")
        self.assertEqual(split_ambiguous_targets([lone], quarantine={(ITEM, "same"): record}), ([], [lone]))

    def test_only_the_resolved_keeper_passes(self):
        record = {"iaItem": ITEM, "stem": "same", "twitchVodIds": ["1", "2"], "keepTwitchVodId": "1"}
        keeper, loser = row("1", "same.mp4"), row("2", "same.mp4")
        self.assertEqual(split_ambiguous_targets([keeper, loser], quarantine={(ITEM, "same"): record}),
                         ([keeper], [loser]))

    def test_records_are_added_to_and_never_dropped(self):
        stored, derived = row("1", "same.mp4"), row("2", "same.mp4")
        created = record_collisions({}, [derived], [stored], "2026-10-22T05:00:00Z")
        self.assertEqual(created, {(ITEM, "same"): {"iaItem": ITEM, "stem": "same", "twitchVodIds": ["1", "2"],
                                                    "detectedAt": "2026-10-22T05:00:00Z"}})
        self.assertEqual(record_collisions(created, [], [stored], "2026-10-23T00:00:00Z"), created)
        grown = record_collisions(created, [row("3", "same.mp4")], [stored], "2026-10-23T00:00:00Z")
        self.assertEqual(grown[(ITEM, "same")]["twitchVodIds"], ["1", "2", "3"])
        self.assertEqual(grown[(ITEM, "same")]["detectedAt"], "2026-10-22T05:00:00Z")

    def test_a_resolved_record_is_left_alone(self):
        record = {"iaItem": ITEM, "stem": "same", "twitchVodIds": ["1", "2"], "keepTwitchVodId": "1"}
        quarantine = {(ITEM, "same"): record}
        self.assertEqual(record_collisions(quarantine, [row("2", "same.mp4")], [], "2026-10-23T00:00:00Z"), quarantine)


if __name__ == "__main__":
    unittest.main()
