"""驗證 CI 與本機使用同一精確豁免，客戶資料仍會被擋。"""
import importlib.util
from pathlib import Path
import unittest
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("customer_filter", Path(__file__).with_name("filter_customer_references.py"))
FILTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FILTER)


class CustomerScanTests(unittest.TestCase):
    def test_exact_identifier_only(self):
        for content in ('customer_display', '{customer_display: customer_display}', 'data.customer_display || ""'):
            with self.subTest(content=content):
                self.assertFalse(FILTER.blocked('src/example.ts:12:' + content))

    def test_customer_terms_still_blocked(self):
        for content in ('customer', 'customer_name = "Example Company"', 'customer_display = "customer Example Company"',
                        'customer_display; customer', 'customer_display_extra', 'my_customer_display',
                        '$customer_display', 'customer_display$', 'Customer_Display', 'CUSTOMER_DISPLAY'):
            with self.subTest(content=content):
                self.assertTrue(FILTER.blocked('src/example.ts:12:' + content))

    def test_ci_and_local_use_same_filter(self):
        command = "(git grep -I -n -i -E 'customer' -- . $CUST_EXCLUDES $REPORT_SOURCES || true) | python .github/scripts/filter_customer_references.py"
        local = (ROOT / '.github/scripts/ci_scan_local.sh').read_text(encoding='utf-8')
        ci = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        self.assertIn(command, local)
        self.assertIn(command, ci)
        self.assertIn('python .github/scripts/test_customer_scan.py', ci)

    def test_filter_cli_preserves_customer_on_same_line(self):
        allowed = 'src/example.ts:1:customer_display'
        blocked = 'src/example.ts:2:customer_display = "customer Example Company"'
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('filter_customer_references.py'))],
                                input=allowed + chr(10) + blocked + chr(10), text=True,
                                capture_output=True, check=True)
        self.assertEqual(result.stdout.strip(), blocked)


if __name__ == '__main__':
    unittest.main()
