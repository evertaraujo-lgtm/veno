using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Veno.Web.Authentication;

namespace Veno.Web.Pages;

public sealed class LoginModel(IUserAuthenticator authenticator, IWebHostEnvironment environment) : PageModel
{
    [BindProperty]
    public LoginInput Input { get; set; } = new();

    public bool ShowDevelopmentCredentials => environment.IsDevelopment();

    public IActionResult OnGet()
    {
        if (User.Identity?.IsAuthenticated == true)
        {
            return RedirectToPage("/Painel/Index");
        }

        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid)
        {
            return Page();
        }

        if (!authenticator.Validate(Input.Email, Input.Password))
        {
            ModelState.AddModelError(string.Empty, "E-mail ou senha inválidos.");
            return Page();
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.Name, Input.Email),
            new Claim(ClaimTypes.Email, Input.Email),
            new Claim(ClaimTypes.Role, "Administrator")
        };

        var principal = new ClaimsPrincipal(
            new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));

        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            principal,
            new AuthenticationProperties { IsPersistent = Input.RememberMe });

        return RedirectToPage("/Painel/Index");
    }

    public sealed class LoginInput
    {
        [Required(ErrorMessage = "Informe seu e-mail.")]
        [EmailAddress(ErrorMessage = "Informe um e-mail válido.")]
        public string Email { get; set; } = string.Empty;

        [Required(ErrorMessage = "Informe sua senha.")]
        [DataType(DataType.Password)]
        public string Password { get; set; } = string.Empty;

        public bool RememberMe { get; set; }
    }
}
