"""Offline tests for CCTV-first priorities and M3U name normalization."""
import unittest

from update import (
    CRITICAL_CHANNELS, FOCUS_CHANNELS, NON_DEFINITIVE_FAILURES,
    normalize_name, parse_m3u,
)

class PriorityTests(unittest.TestCase):
    def test_critical_first(self):
        self.assertEqual(FOCUS_CHANNELS[:2], ["CCTV-1", "CCTV-13"])
        self.assertEqual(tuple(FOCUS_CHANNELS[:2]), CRITICAL_CHANNELS)
        self.assertIn("湖南卫视", FOCUS_CHANNELS)
        self.assertIn("湖北卫视", FOCUS_CHANNELS)

    def test_cctv_canonical(self):
        self.assertEqual(normalize_name("CCTV1"), "CCTV-1")
        self.assertEqual(normalize_name("CCTV-13 (720p)"), "CCTV-13")
        self.assertEqual(normalize_name("CCTV-5+"), "CCTV-5+")
        self.assertEqual(normalize_name("CCTV-5+ (720p)"), "CCTV-5+")
        self.assertEqual(normalize_name("Guangdong Satellite TV"), "广东卫视")

    def test_cctv13_sources_parse(self):
        rows = list(parse_m3u(
            '#EXTM3U\n#EXTINF:-1 group-title="央视频道",CCTV-13\n'
            'http://74.91.26.218:82/live/cctv13hd.m3u8\n'
        ))
        self.assertEqual(rows[0][:2], ("CCTV-13", "央视频道"))

    def test_fallback_does_not_include_definite_dead(self):
        self.assertIn("http_403", NON_DEFINITIVE_FAILURES)
        self.assertIn("slow", NON_DEFINITIVE_FAILURES)
        self.assertNotIn("invalid_media", NON_DEFINITIVE_FAILURES)
        self.assertNotIn("http_404", NON_DEFINITIVE_FAILURES)

if __name__ == "__main__":
    unittest.main()
