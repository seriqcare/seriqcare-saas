import json
import unittest
from datetime import datetime
from types import SimpleNamespace

from backend.services.sandata import build_visit_simulator_payload


class SandataVisitPayloadTests(unittest.TestCase):
    def test_bill_visit_uses_the_simulator_string_contract(self):
        row = SimpleNamespace(id=1024, employee_code='EMP1', client_medicaid_id='1234567890',
            hcpcs_code='S5130', provider_id_sandata='9012456278', place_of_service='12',
            call_in_datetime=datetime(2026, 11, 17, 8), call_out_datetime=datetime(2026, 11, 17, 9),
            call_in_latitude=40.1, call_in_longitude=-75.1, call_out_latitude=40.1, call_out_longitude=-75.1)
        payload = json.loads(json.dumps(build_visit_simulator_payload(row, datetime(2026, 11, 17, 10))))
        self.assertEqual(payload[0]['VisitGeneralInformation']['BillVisit'], 'true')
        self.assertIsInstance(payload[0]['VisitGeneralInformation']['BillVisit'], str)
        self.assertEqual(payload[0]['ProviderIdentification']['ProviderID'], '9012456278')
        self.assertEqual([call['CallAssignment'] for call in payload[0]['Calls']], ['Time In', 'Time Out'])


if __name__ == '__main__':
    unittest.main()
