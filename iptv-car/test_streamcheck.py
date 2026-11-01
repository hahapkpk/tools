"""Offline unit tests of the media detector; no third-party dependencies."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("streamcheck", pathlib.Path(__file__).with_name("streamcheck.py"))
mod = importlib.util.module_from_spec(spec)
import sys
sys.modules["streamcheck"] = mod
spec.loader.exec_module(mod)

class StreamcheckTests(unittest.TestCase):
    def test_detect_transport_stream(self):
        data = bytes([0x47]) + bytes(187)
        self.assertTrue(mod._looks_like_media(data * 4))
        self.assertFalse(mod._looks_like_media(b"<html>fake video</html>"))
    def test_low_speed_rejected(self):
        sample = (bytes([0x47]) + bytes(187)) * 400
        self.assertEqual(mod._rate_media(sample, 1.0, 2.0).state, "rejected")
    def test_good_speed(self):
        sample = (bytes([0x47]) + bytes(187)) * 1400
        self.assertEqual(mod._rate_media(sample, 0.2, 0.3).state, "verified")
    def test_segment_selection(self):
        lines = ["#EXT-X-TARGETDURATION:5", "#EXTINF:5", "s1.ts", "#EXTINF:5", "s2.ts", "#EXTINF:5", "s3.ts"]
        self.assertEqual(mod._media_segment_urls(lines)[:2], ["s2.ts", "s1.ts"])
    def test_prefer_mid_variant(self):
        lines = ["#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360", "low.m3u8",
                 "#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720", "hd.m3u8",
                 "#EXT-X-STREAM-INF:BANDWIDTH=14000000,RESOLUTION=3840x2160", "4k.m3u8"]
        self.assertEqual(mod._variant_url(lines), "hd.m3u8")

if __name__ == "__main__":
    unittest.main()
