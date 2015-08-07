// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.buying");

cur_frm.cscript.tax_table = "Purchase Taxes and Charges";
{% include 'accounts/doctype/purchase_taxes_and_charges_template/purchase_taxes_and_charges_template.js' %}

frappe.require("assets/erpnext/js/controllers/transaction.js");

cur_frm.email_field = "contact_email";

erpnext.buying.BuyingController = erpnext.TransactionController.extend({
	onload: function() {
		this.setup_queries();
		this._super();
	},

	setup_queries: function() {
		var me = this;

		if(this.frm.fields_dict.buying_price_list) {
			this.frm.set_query("buying_price_list", function() {
				return{
					filters: { 'buying': 1 }
				}
			});
		}

		$.each([["supplier", "supplier"],
			["contact_person", "supplier_filter"],
			["supplier_address", "supplier_filter"]],
			function(i, opts) {
				if(me.frm.fields_dict[opts[0]])
					me.frm.set_query(opts[0], erpnext.queries[opts[1]]);
			});

		if(this.frm.fields_dict.supplier) {
			this.frm.set_query("supplier", function() {
				return{	query: "erpnext.controllers.queries.supplier_query" }});
		}

		this.frm.set_query("item_code", "items", function() {
			if(me.frm.doc.is_subcontracted == "Yes") {
				 return{
					query: "erpnext.controllers.queries.item_query",
					filters:{ 'is_sub_contracted_item': 1 }
				}
			} else {
				return{
					query: "erpnext.controllers.queries.item_query",
					filters: { 'is_purchase_item': 1 }
				}
			}
		});
	},

	refresh: function(doc) {
		this.frm.toggle_display("supplier_name",
			(this.supplier_name && this.frm.doc.supplier_name!==this.frm.doc.supplier));
		this._super();
	},

	supplier: function() {
		var me = this;
		erpnext.utils.get_party_details(this.frm, null, null, function(){me.apply_pricing_rule()});
	},

	supplier_address: function() {
		erpnext.utils.get_address_display(this.frm);
	},

	buying_price_list: function() {
		this.apply_price_list();
	},

	price_list_rate: function(doc, cdt, cdn) {
		var item = frappe.get_doc(cdt, cdn);
		frappe.model.round_floats_in(item, ["price_list_rate", "discount_percentage"]);

		item.rate = flt(item.price_list_rate * (1 - item.discount_percentage / 100.0),
			precision("rate", item));

		this.calculate_taxes_and_totals();
	},

	discount_percentage: function(doc, cdt, cdn) {
		this.price_list_rate(doc, cdt, cdn);
	},

	uom: function(doc, cdt, cdn) {
		var me = this;
		var item = frappe.get_doc(cdt, cdn);
		if(item.item_code && item.uom) {
			return this.frm.call({
				method: "erpnext.stock.get_item_details.get_conversion_factor",
				child: item,
				args: {
					item_code: item.item_code,
					uom: item.uom
				},
				callback: function(r) {
					if(!r.exc) {
						me.conversion_factor(me.frm.doc, cdt, cdn);
					}
				}
			});
		}
	},

	qty: function(doc, cdt, cdn) {
		this._super(doc, cdt, cdn);
		this.conversion_factor(doc, cdt, cdn);
	},

	conversion_factor: function(doc, cdt, cdn) {
		if(frappe.meta.get_docfield(cdt, "stock_qty", cdn)) {
			var item = frappe.get_doc(cdt, cdn);
			frappe.model.round_floats_in(item, ["qty", "conversion_factor"]);
			item.stock_qty = flt(item.qty * item.conversion_factor, precision("stock_qty", item));
			refresh_field("stock_qty", item.name, item.parentfield);
		}
	},

	warehouse: function(doc, cdt, cdn) {
		var item = frappe.get_doc(cdt, cdn);
		if(item.item_code && item.warehouse) {
			return this.frm.call({
				method: "erpnext.stock.get_item_details.get_projected_qty",
				child: item,
				args: {
					item_code: item.item_code,
					warehouse: item.warehouse
				}
			});
		}
	},

	project_name: function(doc, cdt, cdn) {
		var item = frappe.get_doc(cdt, cdn);
		if(item.project_name) {
			$.each(this.frm.doc["items"] || [],
				function(i, other_item) {
					if(!other_item.project_name) {
						other_item.project_name = item.project_name;
						refresh_field("project_name", other_item.name, other_item.parentfield);
					}
				});
		}
	},

	category: function(doc, cdt, cdn) {
		// should be the category field of tax table
		if(cdt != doc.doctype) {
			this.calculate_taxes_and_totals();
		}
	},

	calculate_taxes_and_totals: function() {
		this._super();
		this.calculate_total_advance("Purchase Invoice", "advances");
		this.frm.refresh_fields();
	},

	calculate_item_values: function() {
		var me = this;

		$.each(this.frm.doc["items"] || [], function(i, item) {
			frappe.model.round_floats_in(item);
			item.amount = flt(item.rate * item.qty, precision("amount", item));
			item.item_tax_amount = 0.0;

			me._set_in_company_currency(item, "price_list_rate", "base_price_list_rate");
			me._set_in_company_currency(item, "rate", "base_rate");
			me._set_in_company_currency(item, "amount", "base_amount");
		});

	},

	calculate_net_total: function() {
		var me = this;

		this.frm.doc.net_total = this.frm.doc.net_total_import = 0.0;
		$.each(this.frm.doc["items"] || [], function(i, item) {
			me.frm.doc.net_total += item.base_amount;
			me.frm.doc.net_total_import += item.amount;
		});

		frappe.model.round_floats_in(this.frm.doc, ["net_total", "net_total_import"]);
	},

	calculate_totals: function() {
		var tax_count = this.frm.doc["taxes"] ? this.frm.doc["taxes"].length : 0;
		this.frm.doc.grand_total = flt(tax_count ?
			this.frm.doc["taxes"][tax_count - 1].total : this.frm.doc.net_total);
		this.frm.doc.grand_total_import = flt(tax_count ?
			flt(this.frm.doc.grand_total / this.frm.doc.conversion_rate) : this.frm.doc.net_total_import);

		this.frm.doc.total_tax = flt(this.frm.doc.grand_total - this.frm.doc.net_total,
			precision("total_tax"));

		this.frm.doc.grand_total = flt(this.frm.doc.grand_total, precision("grand_total"));
		this.frm.doc.grand_total_import = flt(this.frm.doc.grand_total_import, precision("grand_total_import"));

		// rounded totals
		if(frappe.meta.get_docfield(this.frm.doc.doctype, "rounded_total", this.frm.doc.name)) {
			this.frm.doc.rounded_total = Math.round(this.frm.doc.grand_total);
		}

		if(frappe.meta.get_docfield(this.frm.doc.doctype, "rounded_total_import", this.frm.doc.name)) {
			this.frm.doc.rounded_total_import = Math.round(this.frm.doc.grand_total_import);
		}

		// other charges added/deducted
		this.frm.doc.other_charges_added = 0.0
		this.frm.doc.other_charges_deducted = 0.0
		if(tax_count) {
			this.frm.doc.other_charges_added = frappe.utils.sum($.map(this.frm.doc["taxes"],
				function(tax) { return (tax.add_deduct_tax == "Add"
					&& in_list(["Valuation and Total", "Total"], tax.category)) ?
					tax.tax_amount : 0.0; }));

			this.frm.doc.other_charges_deducted = frappe.utils.sum($.map(this.frm.doc["taxes"],
				function(tax) { return (tax.add_deduct_tax == "Deduct"
					&& in_list(["Valuation and Total", "Total"], tax.category)) ?
					tax.tax_amount : 0.0; }));

			frappe.model.round_floats_in(this.frm.doc,
				["other_charges_added", "other_charges_deducted"]);
		}
		this.frm.doc.other_charges_added_import = flt(this.frm.doc.other_charges_added /
			this.frm.doc.conversion_rate, precision("other_charges_added_import"));
		this.frm.doc.other_charges_deducted_import = flt(this.frm.doc.other_charges_deducted /
			this.frm.doc.conversion_rate, precision("other_charges_deducted_import"));
	},

	/*_cleanup: function() {
		this._super();
		this.frm.doc.in_words = this.frm.doc.in_words_import = "";

		if(this.frm.doc["items"].length) {
			if(!frappe.meta.get_docfield(this.frm.doc["items"][0].doctype, "item_tax_amount", this.frm.doctype)) {
				$.each(this.frm.doc["items"] || [], function(i, item) {
					delete item["item_tax_amount"];
				});
			}
		}

		if(this.frm.doc["taxes"].length) {
			if(!frappe.meta.get_docfield(this.frm.doc["taxes"][0].doctype, "tax_amount_after_discount_amount", this.frm.doctype)) {
				$.each(this.frm.doc["taxes"] || [], function(i, tax) {
					delete tax["tax_amount_after_discount_amount"];
				});
			}
		}
	},*/

	_cleanup: function() {
		this._super();
		this.frm.doc.in_words = this.frm.doc.in_words_import = "";
		if(this.frm.doc["items"]) {
			if(this.frm.doc["items"].length){
				if(!frappe.meta.get_docfield(this.frm.doc["items"][0].doctype, "item_tax_amount", this.frm.doctype)) {
					$.each(this.frm.doc["items"] || [], function(i, item) {
						delete item["item_tax_amount"];
					});
				}
			}
		}

		if(this.frm.doc["taxes"]) {
			if(this.frm.doc["taxes"].length){
				if(!frappe.meta.get_docfield(this.frm.doc["taxes"][0].doctype, "tax_amount_after_discount_amount", this.frm.doctype)) {
					$.each(this.frm.doc["taxes"] || [], function(i, tax) {
						delete tax["tax_amount_after_discount_amount"];
					});
				}
			}
		}
	add_deduct_tax: function(doc, cdt, cdn) {
		this.calculate_taxes_and_totals();
	},

	calculate_outstanding_amount: function() {
		if(this.frm.doc.doctype == "Purchase Invoice" && this.frm.doc.docstatus < 2) {
			frappe.model.round_floats_in(this.frm.doc, ["base_grand_total", "total_advance", "write_off_amount"]);
			this.frm.doc.total_amount_to_pay = flt(this.frm.doc.base_grand_total - this.frm.doc.write_off_amount,
				precision("total_amount_to_pay"));
			if (!this.frm.doc.is_return) {
				this.frm.doc.outstanding_amount = flt(this.frm.doc.total_amount_to_pay - this.frm.doc.total_advance,
					precision("outstanding_amount"));
			}
		}
	}
});
cur_frm.add_fetch('project_name', 'cost_center', 'cost_center');

erpnext.buying.get_default_bom = function(frm) {
	$.each(frm.doc["items"] || [], function(i, d) {
		if (d.item_code && d.bom === "") {
			return frappe.call({
				type: "GET",
				method: "erpnext.stock.get_item_details.get_default_bom",
				args: {
					"item_code": d.item_code,
				},
				callback: function(r) {
					if(r) {
						frappe.model.set_value(d.doctype, d.name, "bom", r.message);
					}
				}
			})
		}
	});
}
