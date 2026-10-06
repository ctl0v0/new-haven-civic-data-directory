import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("alders_checker", Path(__file__).parents[1] / "scripts" / "verify-alders.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RosterTests(unittest.TestCase):
    def test_city_ward_suffix_and_separate_photo_column(self):
        html = '<table><tr><th>WARD</th><th>PHOTO</th><th>NAME</th></tr><tr><td>1-D</td><td><img src="photo"></td><td>Test Representative</td></tr><tr><td>30-R</td><td></td><td>Another Representative</td></tr></table>'
        headings, records = module.extract(html)
        self.assertEqual(headings, ["WARD", "PHOTO", "NAME"])
        self.assertEqual([row["ward"] for row in records], [1, 30])
        self.assertEqual(records[0]["ward_label"], "1-D")
        self.assertEqual(records[0]["representative"], "Test Representative")
    def test_unrelated_page_is_not_roster_data(self):
        with self.assertRaises(ValueError):
            module.extract('<html><p>Please enable JavaScript</p></html>')
    def test_blank_representative_is_rejected(self):
        with self.assertRaises(ValueError):
            module.extract('<table><tr><th>Ward</th><th>Name</th></tr><tr><td>1-D</td><td></td></tr></table>')

if __name__ == "__main__":
    unittest.main()
