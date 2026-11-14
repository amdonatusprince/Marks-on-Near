(function () {
  var script = document.currentScript;
  var origin = script && script.src ? new URL(script.src).origin : "https://marks.leash.market";
  document.querySelectorAll("[data-marks-pay]").forEach(function (button) {
    button.addEventListener("click", function (event) {
      event.preventDefault();
      var params = new URLSearchParams({
        amount: button.getAttribute("data-amount") || "",
        recipient: button.getAttribute("data-recipient") || "",
      });
      var order = button.getAttribute("data-order");
      if (order) params.set("order", order);
      window.location.assign(origin + "/checkout?" + params.toString());
    });
  });
})();
