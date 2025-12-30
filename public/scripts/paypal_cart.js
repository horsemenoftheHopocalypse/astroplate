// Shopping cart state
let shoppingCart = [];

// Get cart from global state or localStorage
function getCart() {
  if (window.paypalCart && window.paypalCart.length > 0) {
    return window.paypalCart;
  }

  const saved = localStorage.getItem('paypalCart');
  return saved ? JSON.parse(saved) : [];
}

// Calculate cart total
function calculateTotal() {
  const cart = getCart();
  return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

// Update cart display
function updateCartDisplay() {
  const cart = getCart();
  const cartItems = document.getElementById('cart-items');
  const cartTotal = document.getElementById('cart-total');
  const paypalContainer = document.getElementById('paypal-button-container');

  if (!cartItems || !cartTotal) return;

  if (cart.length === 0) {
    cartItems.innerHTML = '<p class="text-gray-500">Your cart is empty</p>';
    cartTotal.textContent = '$0.00';
    if (paypalContainer) paypalContainer.style.display = 'none';
    return;
  }

  if (paypalContainer) paypalContainer.style.display = 'block';

  cartItems.innerHTML = cart.map((item, index) => `
    <div class="cart-item flex flex-col sm:flex-row sm:justify-between sm:items-center py-3 border-b gap-2">
      <div class="flex-1 min-w-0 pr-2">
        <h4 class="font-semibold text-sm">${item.name}</h4>
        <p class="text-sm text-gray-600">$${item.price.toFixed(2)} each</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <div class="flex items-center gap-1">
          <button
            onclick="updateQuantity(${index}, -1)"
            class="hover:bg-gray-100 rounded text-sm h-8 flex items-center justify-center"
            style="width: 30px !important; min-width: 30px !important; max-width: 30px !important;"
            ${item.quantity <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed; width: 30px !important; min-width: 30px !important; max-width: 30px !important;"' : ''}
          ><i class="fas fa-minus"></i></button>
          <input
            type="number"
            value="${item.quantity}"
            min="1"
            class="text-center border rounded text-sm h-8"
            style="width: 48px !important; min-width: 48px !important; max-width: 48px !important;"
            onchange="setQuantity(${index}, this.value)"
          />
          <button
            onclick="updateQuantity(${index}, 1)"
            class="hover:bg-gray-100 rounded text-sm h-8 flex items-center justify-center"
            style="width: 30px !important; min-width: 30px !important; max-width: 30px !important;"
          ><i class="fas fa-plus"></i></button>
        </div>
        <span class="font-semibold text-sm w-20 text-right">${'$'}${(item.price * item.quantity).toFixed(2)}</span>
        <button onclick="removeFromCart(${index})" class="text-red-500 hover:text-red-700 h-8 flex items-center justify-center" style="width: 30px !important; min-width: 30px !important; max-width: 30px !important;"><i class="fas fa-times"></i></button>
      </div>
    </div>
  `).join('');

  const total = calculateTotal();
  cartTotal.textContent = `$${total.toFixed(2)}`;
}

// Add to cart function (global for easy access)
window.addToCart = function(name, price, quantity = 1) {
  const cart = getCart();
  const existingItem = cart.find(item => item.name === name);

  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cart.push({ name, price: parseFloat(price), quantity });
  }

  window.paypalCart = cart;
  localStorage.setItem('paypalCart', JSON.stringify(cart));
  updateCartDisplay();
};

// Remove from cart
window.removeFromCart = function(index) {
  const cart = getCart();
  cart.splice(index, 1);
  window.paypalCart = cart;
  localStorage.setItem('paypalCart', JSON.stringify(cart));
  updateCartDisplay();
};

// Update quantity by increment/decrement
window.updateQuantity = function(index, change) {
  const cart = getCart();
  if (cart[index]) {
    const newQuantity = cart[index].quantity + change;
    if (newQuantity >= 1) {
      cart[index].quantity = newQuantity;
      window.paypalCart = cart;
      localStorage.setItem('paypalCart', JSON.stringify(cart));
      updateCartDisplay();
    }
  }
};

// Set quantity directly
window.setQuantity = function(index, value) {
  const cart = getCart();
  const quantity = parseInt(value);
  if (cart[index] && quantity >= 1) {
    cart[index].quantity = quantity;
    window.paypalCart = cart;
    localStorage.setItem('paypalCart', JSON.stringify(cart));
    updateCartDisplay();
  } else if (quantity < 1) {
    // If invalid quantity, restore the display
    updateCartDisplay();
  }
};

// Clear cart
window.clearCart = function() {
  window.paypalCart = [];
  localStorage.removeItem('paypalCart');
  updateCartDisplay();
};

// Initialize cart display and attach event listeners
function initializeCart() {
  // Ensure all containers are visible on page load (reset from any previous success state)
  const cartContainer = document.querySelector('.shopping-cart');
  const catalogContainer = document.querySelector('.product-catalog');
  const resultMessageContainer = document.querySelector('#result-message');

  if (cartContainer) cartContainer.style.display = '';
  if (catalogContainer) catalogContainer.style.display = '';
  if (resultMessageContainer) resultMessageContainer.innerHTML = '';

  updateCartDisplay();

  // Add event delegation for "Add to Cart" buttons
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('add-to-cart-btn')) {
      const button = e.target;
      const productName = button.dataset.productName;
      const productPrice = parseFloat(button.dataset.productPrice);
      const qtyInputId = button.dataset.qtyInput;
      const quantity = parseInt(document.getElementById(qtyInputId)?.value || 1);

      if (productName && !isNaN(productPrice) && quantity > 0) {
        window.addToCart(productName, productPrice, quantity);
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCart);
} else {
  initializeCart();
}

window.paypal
  .Buttons({
    style: {
      shape: "rect",
      layout: "vertical",
      color: "gold",
      label: "paypal",
    },

    async createOrder() {
      try {
        const cart = getCart();

        if (cart.length === 0) {
          throw new Error('Your cart is empty');
        }

        const response = await fetch("/.netlify/functions/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            cart: cart,
          }),
        });

        const orderData = await response.json();

        if (orderData.id) {
          return orderData.id;
        }
        const errorDetail = orderData?.details?.[0];
        const errorMessage = errorDetail
          ? `${errorDetail.issue} ${errorDetail.description} (${orderData.debug_id})`
          : JSON.stringify(orderData);

        throw new Error(errorMessage);
      } catch (error) {
        console.error(error);
        resultMessage(`Could not initiate PayPal Checkout...<br><br>${error}`);
      }
    },

    async onApprove(data, actions) {
      try {
        const response = await fetch(`/.netlify/functions/orders/${data.orderID}/capture`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const orderData = await response.json();
        console.log("Capture response:", orderData);
        console.log("Response status:", response.status);

        // Check if the response is successful
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Three cases to handle:
        //   (1) Recoverable INSTRUMENT_DECLINED -> call actions.restart()
        //   (2) Other non-recoverable errors -> Show a failure message
        //   (3) Successful transaction -> Show confirmation or thank you message

        const errorDetail = orderData?.details?.[0];

        if (errorDetail?.issue === "INSTRUMENT_DECLINED") {
          // (1) Recoverable INSTRUMENT_DECLINED -> call actions.restart()
          // recoverable state, per
          // https://developer.paypal.com/docs/checkout/standard/customize/handle-funding-failures/
          return actions.restart();
        } else if (errorDetail) {
          // (2) Other non-recoverable errors -> Show a failure message
          throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
        } else if (orderData.status === "COMPLETED") {
          // (3) Successful transaction -> Show confirmation or thank you message
          const transaction =
            orderData?.purchase_units?.[0]?.payments?.captures?.[0] ||
            orderData?.purchase_units?.[0]?.payments?.authorizations?.[0];

          console.log("Capture result", orderData, JSON.stringify(orderData, null, 2));

          // Clear the cart after successful payment
          clearCart();

          // Hide the cart and PayPal button
          const cartContainer = document.querySelector('.shopping-cart');
          const paypalContainer = document.getElementById('paypal-button-container');
          const catalogContainer = document.querySelector('.product-catalog');

          if (cartContainer) cartContainer.style.display = 'none';
          if (paypalContainer) paypalContainer.style.display = 'none';
          if (catalogContainer) catalogContainer.style.display = 'none';

          resultMessage(
            `<div class="bg-green-100 border border-green-400 text-green-700 px-6 py-4 rounded-lg">
              <div class="flex items-center mb-2">
                <svg class="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <h3 class="text-xl font-bold">Payment Successful!</h3>
              </div>
              <p class="mb-2">Thank you for your purchase!</p>
              <p class="text-sm">Transaction ID: ${transaction?.id || orderData.id}</p>
              <p class="text-sm mt-3">You should receive a confirmation email shortly.</p>
            </div>`
          );
        } else {
          // If status is not COMPLETED, something went wrong
          throw new Error(`Unexpected order status: ${orderData.status}. Full response: ${JSON.stringify(orderData)}`);
        }
      } catch (error) {
        console.error(error);
        resultMessage(
          `Sorry, your transaction could not be processed...<br><br>${error}`
        );
      }
    },
  })
  .render("#paypal-button-container");

// Example function to show a result to the user. Your site's UI library can be used instead.
function resultMessage(message) {
  const container = document.querySelector("#result-message");
  container.innerHTML = message;
}
