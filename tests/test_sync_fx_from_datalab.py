import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/sync_fx_from_datalab.py"
spec = importlib.util.spec_from_file_location("sync_fx_from_datalab", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40


def rates(date):
    return {"base": "EUR", "date": date, "providerDate": date,
            "checkedAt": date + "T04:00:00Z", "source": "test-provider",
            "rates": {code: 1.0 for code in module.SUPPORTED}}


class FxMirrorTest(unittest.TestCase):
    def test_mirror_preserves_exact_data_lab_file_and_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.json"
            source.write_text(json.dumps(rates("2026-10-15")) + "\n")
            proof = module.mirror(source, root / "data", SHA)
            self.assertEqual((root / "data/exchange_rates.json").read_bytes(), source.read_bytes())
            self.assertEqual(proof["dataLabSha"], SHA)
            self.assertEqual(json.loads((root / "data/metadata.json").read_text())["fxUpdated"], "2026-10-15")

    def test_older_or_incomplete_source_keeps_last_good(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "data"
            data.mkdir()
            target = data / "exchange_rates.json"
            target.write_text(json.dumps(rates("2026-10-15")))
            before = target.read_bytes()
            source = root / "source.json"
            source.write_text(json.dumps(rates("2026-10-14")))
            with self.assertRaisesRegex(ValueError, "regressed"):
                module.mirror(source, data, SHA)
            source.write_text(json.dumps({"rates": {}}))
            with self.assertRaisesRegex(ValueError, "incomplete"):
                module.mirror(source, data, SHA)
            self.assertEqual(target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
