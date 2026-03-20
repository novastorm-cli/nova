using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest request)
    {
        if (request.Email == "admin@test.com" && request.Password == "password")
        {
            return Ok(new { token = "jwt-token-here", user = new { email = request.Email } });
        }
        return Unauthorized(new { message = "Invalid credentials" });
    }

    [HttpPost("register")]
    public IActionResult Register([FromBody] RegisterRequest request)
    {
        return Created("", new { message = "User registered", user = new { email = request.Email, name = request.Name } });
    }
}
