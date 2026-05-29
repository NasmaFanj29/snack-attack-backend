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
  body("tableNumber").exists().toInt().isInt({ min: 1 }),
  body("totalPrice").exists().isFloat({ gt: 0 }),
  body("items").isArray({ min: 1 }),
  body("items.*.name").exists().isString().trim().isLength({ min: 1 }),
  body("items.*.quantity").optional().isInt({ min: 1 }),
  body("items.*.price").optional().isFloat({ min: 0 }),
  body("specialNotes").optional({ nullable: true }).isString(),
];

const staffLoginValidators = [
  body("username").exists().isString().trim().notEmpty(),
  body("password").exists().isString().notEmpty(),
];

const paymentIntentValidators = [
  body("orderId")
    .exists()
    .customSanitizer(v => Number(v))
    .isInt({ min: 1 }),
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