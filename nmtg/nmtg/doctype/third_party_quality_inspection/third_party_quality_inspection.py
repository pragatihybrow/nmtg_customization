# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class ThirdPartyQualityInspection(Document):
    def validate(self):
        self.calculate_accepted_rejected_qty()

    def calculate_accepted_rejected_qty(self):
        try:
            data = json.loads(self.testing_data or "{}")
        except Exception:
            data = {}

        # testing types selected on this document
        testing_types = [row.testing_type for row in (self.testing_type or []) if row.testing_type]

        # all heat numbers present in the testing matrix
        heats = []
        for t in testing_types:
            for heat in (data.get(t) or {}).keys():
                if heat not in heats:
                    heats.append(heat)

        if not heats or not testing_types:
            self.accepted_qty = 0
            self.rejected_qty = 0
            return

        qty_per_heat = flt(self.qty) / len(heats)

        accepted_heats = []
        for heat in heats:
            passed_all = all(
                str((data.get(t) or {}).get(heat, "")).strip().lower() == "yes"
                for t in testing_types
            )
            if passed_all:
                accepted_heats.append(heat)

        self.accepted_qty = flt(qty_per_heat * len(accepted_heats), 3)
        self.rejected_qty = flt(flt(self.qty) - self.accepted_qty, 3)