using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Veno.Web.Pages;

public sealed class IndexModel : PageModel
{
    public IActionResult OnGet() => User.Identity?.IsAuthenticated == true
        ? RedirectToPage("/Painel/Index")
        : RedirectToPage("/Login");
}
