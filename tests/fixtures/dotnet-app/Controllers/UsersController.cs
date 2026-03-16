using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll()
    {
        return Ok(new { users = Array.Empty<object>() });
    }

    [HttpPost]
    public IActionResult Create([FromBody] object user)
    {
        return Created("", user);
    }
}
