namespace Veno.Web.Authentication;

public interface IUserAuthenticator
{
    bool Validate(string email, string password);
}
