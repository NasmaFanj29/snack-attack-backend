const { body, param, validationResult } = require("express-validator");

function validateRequest(validations) {
  return async (req, res, next) => {
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    next();
  };
}

const placeOrderValidators = [
  body("customer").optional().isObject(),
  body("customer.name").optional().isString().trim().isLength({ min: 1, max: 100 }),
  body("customer.phone").optional().isString().trim().isLength({ min: 6, max: 25 }),
  body("table_id").optional().isInt({ min: 1 }),
  body("total_price").exists().isFloat({ gt: 0 }),
  body("items").isArray({ min: 1 }),
  body("items.*.name").exists().isString().trim().isLength({ min: 1 }),
  body("items.*.quantity").optional().isInt({ min: 1 }),
  body("items.*.price").optional().isFloat({ gt: 0 }),
  body("items.*.databaseId").optional().isInt({ min: 1 }),
  body("items.*.item_id").optional().isInt({ min: 1 }),
  body("items.*.menu_id").optional().isInt({ min: 1 }),
  body("items.*.id").optional().isInt({ min: 1 }),
  body("items.*.isCustom").optional().isBoolean(),
  body("payment_splits").optional().isArray(),
];

const staffLoginValidators = [
  body("username").exists().isString().trim().notEmpty(),
  body("password").exists().isString().notEmpty(),
];

const paymentIntentValidators = [
  body("amount").exists().isFloat({ gt: 0 }),
  body("orderId").optional().isInt({ min: 1 }),
];

const chatValidators = [
  body("messages").isArray({ min: 1 }),
  body("menuItems").optional().isArray(),
];

const orderIdParamValidator = [param("id").isInt({ min: 1 })];

module.exports = {
  validateRequest,
  placeOrderValidators,
  staffLoginValidators,
  paymentIntentValidators,
  chatValidators,
  orderIdParamValidator,
};
