using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Veno.Web.Pages.Painel;

[Authorize]
public sealed class IndexModel : PageModel
{
    public void OnGet()
    {
    }
}
